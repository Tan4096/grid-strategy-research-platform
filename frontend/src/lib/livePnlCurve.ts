import type { LiveMonitoringTrendPoint } from "../types";
import type { CurvePoint, LiveSnapshotResponse } from "../lib/api-schema";

export type LivePnlCurveSource = "replay" | "simulated" | "ledger" | "daily" | "trend" | "snapshot";

export interface LivePnlCurveData {
  points: CurvePoint[];
  latestValue: number;
  previousValue: number | null;
  deltaFromPrevious: number | null;
  source: LivePnlCurveSource;
  sourceSummary: string;
  startTimestamp: string;
  endTimestamp: string;
}

function maxAbsPointValue(points: CurvePoint[]): number {
  return points.reduce((max, point) => {
    const value = Math.abs(point.value);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
}

function isCurvePlausible(curve: LivePnlCurveData | null, snapshot: LiveSnapshotResponse): boolean {
  if (!curve || curve.points.length === 0) {
    return false;
  }
  const investment = snapshot.robot.investment_usdt;
  if (investment === null || investment === undefined || !Number.isFinite(investment) || investment <= 0) {
    return true;
  }
  const currentReturnPct = (curve.latestValue / investment) * 100;
  const maxAbsReturnPct = (maxAbsPointValue(curve.points) / investment) * 100;
  if (!Number.isFinite(currentReturnPct) || !Number.isFinite(maxAbsReturnPct)) {
    return false;
  }
  const dynamicLimit = Math.max(500, Math.abs(currentReturnPct) * 8 + 100);
  return maxAbsReturnPct <= dynamicLimit;
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveTotalPnl(snapshot: LiveSnapshotResponse): number {
  if (typeof snapshot.robot.total_pnl === "number" && Number.isFinite(snapshot.robot.total_pnl)) {
    return snapshot.robot.total_pnl;
  }
  if (typeof snapshot.ledger_summary?.total_pnl === "number" && Number.isFinite(snapshot.ledger_summary.total_pnl)) {
    return snapshot.ledger_summary.total_pnl;
  }
  return snapshot.summary.total_pnl;
}

function findDiagnosticMessage(snapshot: LiveSnapshotResponse, codes: string[]): string | null {
  for (const code of codes) {
    const match = snapshot.diagnostics.find((item) => item.code === code && item.message.trim());
    if (match) {
      return match.message.trim();
    }
  }
  return null;
}

function replayFallbackSummary(snapshot: LiveSnapshotResponse, mode: "trend" | "snapshot"): string {
  const klineMessage = findDiagnosticMessage(snapshot, ["pnl_curve_kline_unavailable"]);
  if (klineMessage) {
    return mode === "trend"
      ? `${klineMessage} 当前退回为监测期间的实盘收益快照。`
      : `${klineMessage} 当前仅展示最新收益快照。`;
  }

  const fillsMessage = findDiagnosticMessage(snapshot, [
    "pnl_curve_fills_incomplete",
    "fills_not_available",
    "fills_truncated",
    "LIVE_BOT_FILLS_CAPPED"
  ]);
  if (fillsMessage) {
    return mode === "trend"
      ? `${fillsMessage} 当前退回为监测期间的实盘收益快照。`
      : `${fillsMessage} 当前仅展示最新收益快照。`;
  }

  return mode === "trend"
    ? "当前退回为监测期间的实盘收益快照。"
    : "当前仅拿到最新快照，后续实盘同步会继续补全收益曲线。";
}

function trendCoversStrategyStart(
  startTimestamp: string,
  firstTrendTimestamp: string,
  pollIntervalSec: number | null | undefined
): boolean {
  const startMs = parseMs(startTimestamp);
  const firstMs = parseMs(firstTrendTimestamp);
  if (startMs === null || firstMs === null) {
    return false;
  }
  const maxGapMs = Math.max(((pollIntervalSec ?? 0) * 1000 * 4), 30 * 60 * 1000);
  return firstMs <= startMs + maxGapMs;
}

function snapshotSummaryWhenTrendStartsLate(snapshot: LiveSnapshotResponse): string {
  const reason = replayFallbackSummary(snapshot, "snapshot");
  return `${reason} 监测趋势仅覆盖监测启动以来的数据，未覆盖策略启动以来的完整区间，因此未直接用于收益率曲线。`;
}

function sortPointsAscending(points: CurvePoint[]): CurvePoint[] {
  return [...points].sort((left, right) => {
    const leftMs = parseMs(left.timestamp) ?? 0;
    const rightMs = parseMs(right.timestamp) ?? 0;
    return leftMs - rightMs;
  });
}

function appendLatestPoint(points: CurvePoint[], timestamp: string, value: number): CurvePoint[] {
  const next = [...points];
  const last = next[next.length - 1];
  if (!last) {
    return [{ timestamp, value }];
  }
  const lastMs = parseMs(last.timestamp);
  const nextMs = parseMs(timestamp);
  const sameInstant =
    last.timestamp === timestamp || (lastMs !== null && nextMs !== null && Math.abs(lastMs - nextMs) < 1_000);
  if (sameInstant) {
    next[next.length - 1] = { timestamp, value };
    return next;
  }
  if (last.value === value && lastMs !== null && nextMs !== null && nextMs <= lastMs) {
    return next;
  }
  next.push({ timestamp, value });
  return sortPointsAscending(next);
}

function buildReplayCurve(snapshot: LiveSnapshotResponse, startTimestamp: string, currentTimestamp: string, currentValue: number): LivePnlCurveData | null {
  const points = sortPointsAscending(
    (snapshot.pnl_curve ?? [])
      .filter((point) => parseMs(point.timestamp) !== null)
      .map((point) => ({
        timestamp: point.timestamp,
        value: point.value
      }))
  );
  if (points.length === 0) {
    return null;
  }
  const withCurrent = appendLatestPoint(points, currentTimestamp, currentValue);
  const previousValue = withCurrent.length > 1 ? withCurrent[withCurrent.length - 2]?.value ?? null : null;
  const replayMessage = findDiagnosticMessage(snapshot, ["pnl_curve_replay_available"]);
  const simulatedMessage = findDiagnosticMessage(snapshot, ["pnl_curve_simulated"]);
  const sourceSummary =
    replayMessage ?? simulatedMessage ??
    (snapshot.completeness?.fills_complete === false || snapshot.monitoring?.fills_capped
      ? "曲线按已同步成交回放和历史价格重建，成交记录不完整时会与交易所有偏差。"
      : "曲线按实盘成交回放和历史价格重建，比单纯账单累计更接近交易所实盘页。");
  return {
    points: withCurrent,
    latestValue: currentValue,
    previousValue,
    deltaFromPrevious: previousValue === null ? null : currentValue - previousValue,
    source: replayMessage ? "replay" : simulatedMessage ? "simulated" : "replay",
    sourceSummary,
    startTimestamp,
    endTimestamp: currentTimestamp
  };
}

function hasUsableReplayCurve(snapshot: LiveSnapshotResponse): boolean {
  if ((snapshot.pnl_curve ?? []).length < 2) {
    return false;
  }
  return snapshot.diagnostics.some((item) => item.code === "pnl_curve_replay_available" || item.code === "pnl_curve_simulated");
}

function _buildLedgerCurve(snapshot: LiveSnapshotResponse, startTimestamp: string, currentTimestamp: string, currentValue: number): LivePnlCurveData | null {
  const entries = [...(snapshot.ledger_entries ?? [])]
    .filter((entry) => parseMs(entry.timestamp) !== null)
    .sort((left, right) => (parseMs(left.timestamp) ?? 0) - (parseMs(right.timestamp) ?? 0));
  if (entries.length === 0) {
    return null;
  }

  const grouped = new Map<string, number>();
  entries.forEach((entry) => {
    grouped.set(entry.timestamp, (grouped.get(entry.timestamp) ?? 0) + entry.amount);
  });

  let cumulative = 0;
  const points: CurvePoint[] = [{ timestamp: startTimestamp, value: 0 }];
  Array.from(grouped.entries())
    .sort((left, right) => (parseMs(left[0]) ?? 0) - (parseMs(right[0]) ?? 0))
    .forEach(([timestamp, amount]) => {
      cumulative += amount;
      points.push({ timestamp, value: cumulative });
    });

  const withCurrent = appendLatestPoint(points, currentTimestamp, currentValue);
  const previousValue = withCurrent.length > 1 ? withCurrent[withCurrent.length - 2]?.value ?? null : null;
  const unrealizedGap = currentValue - cumulative;
  return {
    points: withCurrent,
    latestValue: currentValue,
    previousValue,
    deltaFromPrevious: previousValue === null ? null : currentValue - previousValue,
    source: "ledger",
    sourceSummary:
      Math.abs(unrealizedGap) > 1e-6
        ? "曲线按实盘账单累计生成，末尾补入当前未实现盈亏。"
        : "曲线按策略开始以来的实盘账单累计生成。",
    startTimestamp,
    endTimestamp: currentTimestamp
  };
}

function _buildDailyCurve(snapshot: LiveSnapshotResponse, startTimestamp: string, currentTimestamp: string, currentValue: number): LivePnlCurveData | null {
  const days = [...(snapshot.daily_breakdown ?? [])].sort((left, right) => {
    const leftMs = parseMs(`${left.date}T23:59:59`) ?? 0;
    const rightMs = parseMs(`${right.date}T23:59:59`) ?? 0;
    return leftMs - rightMs;
  });
  if (days.length === 0) {
    return null;
  }

  let cumulative = 0;
  const points: CurvePoint[] = [{ timestamp: startTimestamp, value: 0 }];
  days.forEach((day) => {
    cumulative += day.total_pnl;
    points.push({
      timestamp: `${day.date}T23:59:59`,
      value: cumulative
    });
  });

  const withCurrent = appendLatestPoint(points, currentTimestamp, currentValue);
  const previousValue = withCurrent.length > 1 ? withCurrent[withCurrent.length - 2]?.value ?? null : null;
  return {
    points: withCurrent,
    latestValue: currentValue,
    previousValue,
    deltaFromPrevious: previousValue === null ? null : currentValue - previousValue,
    source: "daily",
    sourceSummary: "成交账单为空，曲线按日汇总累计生成，末尾补入当前总收益。",
    startTimestamp,
    endTimestamp: currentTimestamp
  };
}

function buildTrendCurve(
  snapshot: LiveSnapshotResponse,
  trend: LiveMonitoringTrendPoint[],
  startTimestamp: string,
  currentTimestamp: string,
  currentValue: number
): LivePnlCurveData | null {
  const points = sortPointsAscending(
    trend
      .filter((item) => parseMs(item.timestamp) !== null)
      .map((item) => ({
        timestamp: item.timestamp,
        value: item.total_pnl
      }))
  );
  if (points.length === 0) {
    return null;
  }

  const withCurrent = appendLatestPoint(points, currentTimestamp, currentValue);
  const previousValue = withCurrent.length > 1 ? withCurrent[withCurrent.length - 2]?.value ?? null : null;
  return {
    points: withCurrent,
    latestValue: currentValue,
    previousValue,
    deltaFromPrevious: previousValue === null ? null : currentValue - previousValue,
    source: "trend",
    sourceSummary: replayFallbackSummary(snapshot, "trend"),
    startTimestamp,
    endTimestamp: currentTimestamp
  };
}

export function buildLivePnlCurve(snapshot: LiveSnapshotResponse, trend: LiveMonitoringTrendPoint[]): LivePnlCurveData {
  const startTimestamp = snapshot.window?.strategy_started_at ?? snapshot.account.strategy_started_at ?? snapshot.account.fetched_at;
  const currentTimestamp = snapshot.window?.fetched_at ?? snapshot.account.fetched_at;
  const currentValue = resolveTotalPnl(snapshot);
  const replayCurve = buildReplayCurve(snapshot, startTimestamp, currentTimestamp, currentValue);
  if (replayCurve && (hasUsableReplayCurve(snapshot) || isCurvePlausible(replayCurve, snapshot))) {
    return replayCurve;
  }

  const trendCurve = buildTrendCurve(snapshot, trend, startTimestamp, currentTimestamp, currentValue);
  if (
    trendCurve &&
    isCurvePlausible(trendCurve, snapshot) &&
    trendCoversStrategyStart(startTimestamp, trendCurve.points[0]?.timestamp ?? "", snapshot.monitoring?.poll_interval_sec)
  ) {
    return trendCurve;
  }

  return {
    points: [{ timestamp: currentTimestamp, value: currentValue }],
    latestValue: currentValue,
    previousValue: null,
    deltaFromPrevious: null,
    source: "snapshot",
    sourceSummary:
      trendCurve && trendCurve.points.length > 0
        ? snapshotSummaryWhenTrendStartsLate(snapshot)
        : replayFallbackSummary(snapshot, "snapshot"),
    startTimestamp,
    endTimestamp: currentTimestamp
  };
}
