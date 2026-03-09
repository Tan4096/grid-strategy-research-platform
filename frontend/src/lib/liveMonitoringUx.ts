import type { LiveDiagnostic, LiveLedgerEntry, LiveRobotListItem, LiveSnapshotResponse } from "../lib/api-schema";

export type LiveMonitoringRiskLevel = "safe" | "watch" | "danger";
export type LiveMonitoringIntegrityLevel = "high" | "medium" | "low";
export type LiveMonitoringAttentionSeverity = "danger" | "warning" | "info";
export type LiveMonitoringAttentionAction =
  | "retry_sync"
  | "shrink_time_window"
  | "review_time_window"
  | "review_ledger"
  | "apply_parameters"
  | null;

export interface LiveMonitoringAttentionItem {
  key: string;
  severity: LiveMonitoringAttentionSeverity;
  title: string;
  message: string;
  action: LiveMonitoringAttentionAction;
  actionLabel: string | null;
}

export interface LiveMonitoringHeadline {
  riskLevel: LiveMonitoringRiskLevel;
  integrityLevel: LiveMonitoringIntegrityLevel;
  liquidationDistancePct: number | null;
  stopDistancePct: number | null;
  attentionItems: LiveMonitoringAttentionItem[];
  pnlSourceSummary: string;
  pnl24h: number | null;
}

export type LiveMonitoringReadinessStatus = "ready" | "pending" | "warning";

export interface LiveMonitoringReadinessStep {
  key: "environment" | "credentials" | "robot";
  label: string;
  status: LiveMonitoringReadinessStatus;
  detail: string;
}

interface BuildLiveMonitoringReadinessParams {
  exchange: string | null;
  symbol: string;
  strategyStartedAt: string | null;
  credentialsReady: boolean;
  selectedRobotReady: boolean;
  selectedRobotMissing?: boolean;
  robotListLoading: boolean;
  robotListError?: string | null;
  monitoringActive: boolean;
  autoRefreshPaused: boolean;
  autoRefreshPausedReason?: string | null;
}

function asPositiveFiniteNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}


function deriveReferencePrice(snapshot: LiveSnapshotResponse): number | null {
  const apiPrice = asPositiveFiniteNumber(snapshot.market_params?.reference_price);
  if (apiPrice !== null) {
    return apiPrice;
  }

  const direct =
    asPositiveFiniteNumber(snapshot.position.mark_price) ??
    asPositiveFiniteNumber(snapshot.position.entry_price);
  if (direct !== null) {
    return direct;
  }

  const quantity = asPositiveFiniteNumber(snapshot.position.quantity);
  const notional =
    asPositiveFiniteNumber(snapshot.position.notional) ??
    asPositiveFiniteNumber(snapshot.summary.position_notional);
  if (quantity !== null && notional !== null) {
    return notional / quantity;
  }

  const robotMidpoint =
    asPositiveFiniteNumber(snapshot.robot.lower_price) !== null && asPositiveFiniteNumber(snapshot.robot.upper_price) !== null
      ? (asPositiveFiniteNumber(snapshot.robot.lower_price)! + asPositiveFiniteNumber(snapshot.robot.upper_price)!) / 2
      : null;
  if (robotMidpoint !== null) {
    return robotMidpoint;
  }

  const inferredMidpoint =
    asPositiveFiniteNumber(snapshot.inferred_grid.lower) !== null && asPositiveFiniteNumber(snapshot.inferred_grid.upper) !== null
      ? (asPositiveFiniteNumber(snapshot.inferred_grid.lower)! + asPositiveFiniteNumber(snapshot.inferred_grid.upper)!) / 2
      : null;
  if (inferredMidpoint !== null) {
    return inferredMidpoint;
  }

  const activeLevels = snapshot.inferred_grid.active_levels.filter((item) => item > 0);
  if (activeLevels.length > 0) {
    return activeLevels.reduce((sum, item) => sum + item, 0) / activeLevels.length;
  }

  return null;
}

function buildDistancePct(markPrice: number | null, triggerPrice: number | null): number | null {
  if (!markPrice || !triggerPrice) {
    return null;
  }
  return Math.abs(((triggerPrice - markPrice) / markPrice) * 100);
}

function dedupeAttentionItems(items: LiveMonitoringAttentionItem[]): LiveMonitoringAttentionItem[] {
  const seen = new Set<string>();
  const ordered = [...items].sort((left, right) => {
    const severityRank = { danger: 0, warning: 1, info: 2 };
    return severityRank[left.severity] - severityRank[right.severity];
  });
  return ordered.filter((item) => {
    if (seen.has(item.key)) {
      return false;
    }
    seen.add(item.key);
    return true;
  });
}

function computePnl24h(snapshot: LiveSnapshotResponse): number | null {
  const fetchedAt = Date.parse(snapshot.window?.fetched_at ?? snapshot.account.fetched_at);
  if (!Number.isFinite(fetchedAt)) {
    return null;
  }
  const recentEntries = (snapshot.ledger_entries ?? []).filter((entry) => fetchedAt - Date.parse(entry.timestamp) <= 24 * 3600 * 1000);
  if (recentEntries.length === 0) {
    const recentDaily = snapshot.daily_breakdown?.[snapshot.daily_breakdown.length - 1];
    return recentDaily ? recentDaily.total_pnl : null;
  }
  return recentEntries.reduce((sum, entry) => sum + normalizeLedgerPnl(entry), 0);
}

function normalizeLedgerPnl(entry: LiveLedgerEntry): number {
  if (entry.kind === "trade") {
    return entry.pnl;
  }
  if (entry.kind === "fee") {
    return entry.amount !== 0 ? entry.amount : -Math.abs(entry.fee);
  }
  return entry.amount;
}

function hasDiagnosticCode(diagnostics: LiveDiagnostic[], code: string): boolean {
  return diagnostics.some((item) => item.code === code);
}

export function normalizeLiveRobotSymbol(value: string): string {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[-_/]/g, "")
    .replace(/SWAP$/, "");
}

export function sortLiveRobotItems(items: LiveRobotListItem[], symbol: string): LiveRobotListItem[] {
  const normalizedCurrentSymbol = normalizeLiveRobotSymbol(symbol);
  return [...items].sort((left, right) => {
    const leftMatch = normalizeLiveRobotSymbol(left.symbol) === normalizedCurrentSymbol ? 0 : 1;
    const rightMatch = normalizeLiveRobotSymbol(right.symbol) === normalizedCurrentSymbol ? 0 : 1;
    if (leftMatch !== rightMatch) {
      return leftMatch - rightMatch;
    }
    const leftRunning = (left.state || "").toLowerCase() === "running" ? 0 : 1;
    const rightRunning = (right.state || "").toLowerCase() === "running" ? 0 : 1;
    if (leftRunning !== rightRunning) {
      return leftRunning - rightRunning;
    }
    const leftUpdated = left.updated_at ? Date.parse(left.updated_at) : 0;
    const rightUpdated = right.updated_at ? Date.parse(right.updated_at) : 0;
    if (leftUpdated !== rightUpdated) {
      return rightUpdated - leftUpdated;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });
}

export function findPreferredLiveRobot(
  items: LiveRobotListItem[],
  symbol: string,
  options: { requireRunning?: boolean } = {}
): LiveRobotListItem | null {
  const normalizedCurrentSymbol = normalizeLiveRobotSymbol(symbol);
  if (!normalizedCurrentSymbol) {
    return null;
  }
  const sorted = sortLiveRobotItems(items, symbol);
  return (
    sorted.find((item) => {
      if (normalizeLiveRobotSymbol(item.symbol) !== normalizedCurrentSymbol) {
        return false;
      }
      if (options.requireRunning) {
        return (item.state || "").toLowerCase() === "running";
      }
      return true;
    }) ?? null
  );
}

export function buildLiveMonitoringReadiness({
  exchange,
  symbol,
  strategyStartedAt,
  credentialsReady,
  selectedRobotReady,
  selectedRobotMissing = false,
  robotListLoading,
  robotListError = null,
  monitoringActive: _monitoringActive,
  autoRefreshPaused: _autoRefreshPaused,
  autoRefreshPausedReason: _autoRefreshPausedReason = null
}: BuildLiveMonitoringReadinessParams): LiveMonitoringReadinessStep[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const environmentReady = exchange === "okx" && Boolean(normalizedSymbol && strategyStartedAt);

  const environmentStep: LiveMonitoringReadinessStep = {
    key: "environment",
    label: "交易环境",
    status: environmentReady ? "ready" : exchange && exchange !== "okx" ? "warning" : "pending",
    detail: environmentReady
      ? `OKX · ${normalizedSymbol}`
      : exchange && exchange !== "okx"
        ? "仅支持 OKX"
        : !exchange
          ? "待选择交易所"
          : !normalizedSymbol
            ? "待填写交易对"
            : "待填写起始时间"
  };

  const credentialsStep: LiveMonitoringReadinessStep = {
    key: "credentials",
    label: "凭证",
    status: credentialsReady ? "ready" : "pending",
    detail: credentialsReady ? "OKX 凭证已就绪" : "待填写 OKX 凭证"
  };

  const robotStep: LiveMonitoringReadinessStep = {
    key: "robot",
    label: "监测对象",
    status: robotListError || selectedRobotMissing ? "warning" : selectedRobotReady ? "ready" : "pending",
    detail: robotListError
      ? "对象列表加载失败"
      : selectedRobotMissing
        ? "当前对象已失效"
        : robotListLoading
          ? "读取对象中"
          : selectedRobotReady
            ? "已选择监测对象"
            : credentialsReady
              ? "待选择监测对象"
              : "待读取对象列表"
  };

  return [environmentStep, credentialsStep, robotStep];
}

export function buildPrimaryAttentionItem(items: LiveMonitoringAttentionItem[]): LiveMonitoringAttentionItem | null {
  return items[0] ?? null;
}

export function buildLiveMonitoringHeadline(snapshot: LiveSnapshotResponse): LiveMonitoringHeadline {
  const markPrice = deriveReferencePrice(snapshot);
  const liquidationPrice =
    asPositiveFiniteNumber(snapshot.robot.liquidation_price) ??
    asPositiveFiniteNumber(snapshot.position.liquidation_price);
  const stopLossPrice = asPositiveFiniteNumber(snapshot.robot.stop_loss_price);
  const liquidationDistancePct = buildDistancePct(markPrice, liquidationPrice);
  const stopDistancePct = buildDistancePct(markPrice, stopLossPrice);
  const hasWarning = snapshot.diagnostics.some((item) => item.level === "warning");
  const hasPartial = snapshot.completeness.partial_failures.length > 0;

  let riskLevel: LiveMonitoringRiskLevel = "safe";
  if ((liquidationDistancePct !== null && liquidationDistancePct < 2) || (snapshot.monitoring.stale && hasPartial)) {
    riskLevel = "danger";
  } else if (
    (liquidationDistancePct !== null && liquidationDistancePct < 5) ||
    (stopDistancePct !== null && stopDistancePct < 5) ||
    hasWarning
  ) {
    riskLevel = "watch";
  }

  let integrityLevel: LiveMonitoringIntegrityLevel = "medium";
  if (snapshot.completeness.fills_complete && snapshot.completeness.funding_complete && !snapshot.monitoring.stale) {
    integrityLevel = "high";
  } else if (snapshot.monitoring.stale || (!snapshot.completeness.fills_complete && snapshot.monitoring.fills_capped)) {
    integrityLevel = "low";
  }

  const attentionItems = dedupeAttentionItems(
    [
      snapshot.monitoring.stale
        ? {
            key: "stale",
            severity: snapshot.completeness.partial_failures.length > 0 ? "danger" : "warning",
            title: "监测延迟",
            message: "当前展示最近一次成功快照，建议稍后重试或重新连接。",
            action: "retry_sync",
            actionLabel: "重试"
          }
        : null,
      snapshot.monitoring.fills_capped
        ? {
            key: "fills_capped",
            severity: "warning",
            title: "成交窗口被截断",
            message: `当前仅同步到最近 ${snapshot.monitoring.fills_page_count} 页成交，更早记录未纳入。`,
            action: "shrink_time_window",
            actionLabel: "缩短监测窗口"
          }
        : null,
      snapshot.completeness.bills_window_clipped || hasDiagnosticCode(snapshot.diagnostics, "funding_window_clipped")
        ? {
            key: "funding_window_clipped",
            severity: "warning",
            title: "账单窗口过长",
            message: "当前账单窗口被裁剪，建议缩短统计区间后再看成本与收益。",
            action: "shrink_time_window",
            actionLabel: "缩短监测窗口"
          }
        : null,
      hasDiagnosticCode(snapshot.diagnostics, "LIVE_BOT_ORDERS_UNAVAILABLE")
        ? {
            key: "orders_unavailable",
            severity: "warning",
            title: "挂单状态缺失",
            message: "挂单抓取失败，挂单状态与账单判断可能失真。",
            action: "review_ledger",
            actionLabel: "查看逐笔账单"
          }
        : null,
      liquidationDistancePct !== null && liquidationDistancePct < 5
        ? {
            key: "liquidation_risk",
            severity: liquidationDistancePct < 2 ? "danger" : "warning",
            title: "强平风险升高",
            message: `当前距强平仅 ${liquidationDistancePct.toFixed(2)}%，请立即检查区间、杠杆与止损。`,
            action: "apply_parameters",
            actionLabel: "回填到左侧参数"
          }
        : null,
      stopDistancePct !== null && stopDistancePct < 5
        ? {
            key: "stop_loss_risk",
            severity: stopDistancePct < 2 ? "danger" : "warning",
            title: "止损触发临近",
            message: `当前距止损仅 ${stopDistancePct.toFixed(2)}%，请复核区间与风控设置。`,
            action: "apply_parameters",
            actionLabel: "回填到左侧参数"
          }
        : null,
      ...snapshot.diagnostics
        .filter((item) => item.level !== "info")
        .map((item) => ({
          key: `diagnostic-${item.code}`,
          severity: item.level === "error" ? "danger" : "warning",
          title: item.code,
          message: item.message,
          action:
            item.action_hint === "retry_sync" ||
            item.action_hint === "shrink_time_window" ||
            item.action_hint === "review_time_window" ||
            item.action_hint === "review_ledger"
              ? item.action_hint
              : null,
          actionLabel:
            item.action_hint === "retry_sync"
              ? "重试"
              : item.action_hint === "shrink_time_window"
                ? "缩短监测窗口"
                : item.action_hint === "review_time_window"
                  ? "回填起点"
                  : item.action_hint === "review_ledger"
                    ? "查看逐笔账单"
                    : null
        }))
    ].filter((item): item is LiveMonitoringAttentionItem => item !== null)
  ).slice(0, 3);

  const gridProfit = snapshot.robot.grid_profit ?? snapshot.ledger_summary.realized;
  const floatingProfit = snapshot.robot.floating_profit ?? snapshot.ledger_summary.unrealized;
  const fundingFee = snapshot.robot.funding_fee ?? snapshot.ledger_summary.funding;

  return {
    riskLevel,
    integrityLevel,
    liquidationDistancePct,
    stopDistancePct,
    attentionItems,
    pnlSourceSummary: `网格已实现 ${gridProfit.toFixed(2)} USDT · 浮动盈亏 ${floatingProfit.toFixed(2)} USDT · 资金费 ${fundingFee.toFixed(2)} USDT`,
    pnl24h: computePnl24h(snapshot)
  };
}
