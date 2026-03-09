import { BacktestRequest, BacktestResponse, LiveComparisonMetric, LiveComparisonSummary, LiveSnapshotResponse } from "../types";

interface Params {
  request: BacktestRequest;
  result: BacktestResponse | null;
  snapshot: LiveSnapshotResponse | null;
}

function normalizeSymbol(value: string): string {
  return (value || "").trim().toUpperCase().replace(/[-_/]/g, "").replace(/SWAP$/, "");
}

function latestCurveValue(
  result: BacktestResponse,
  key: "equity_curve" | "unrealized_pnl_curve" | "leverage_usage_curve",
  fallback = 0
): number {
  const curve = result[key];
  const last = curve[curve.length - 1];
  return typeof last?.value === "number" ? last.value : fallback;
}

function latestOpenPositions(result: BacktestResponse): number {
  for (let idx = result.events.length - 1; idx >= 0; idx -= 1) {
    const event = result.events[idx];
    if (event.event_type !== "snapshot") {
      continue;
    }
    const count = Number(event.payload?.open_positions);
    if (Number.isFinite(count)) {
      return count;
    }
  }
  return 0;
}

function realizedGross(result: BacktestResponse): number {
  return result.trades.reduce((sum, item) => sum + item.gross_pnl, 0);
}

function tradingNetExcludingFunding(result: BacktestResponse): number {
  const unrealized = latestCurveValue(result, "unrealized_pnl_curve", 0);
  return result.summary.total_return_usdt - unrealized - result.summary.funding_net;
}

function pushReason(target: string[], condition: boolean, text: string): void {
  if (condition && !target.includes(text)) {
    target.push(text);
  }
}

function explainMetric(key: LiveComparisonMetric["key"], snapshot: LiveSnapshotResponse): string {
  const completeness = snapshot.completeness ?? {
    fills_complete: false,
    funding_complete: false,
    bills_window_clipped: false,
    partial_failures: []
  };
  switch (key) {
    case "total_pnl":
      return "总收益按已实现 + 未实现 - 手续费 + 资金费净额统一口径比较。";
    case "trading_net":
      return completeness.fills_complete
        ? "交易净收益已排除资金费，主要反映成交与手续费差异。"
        : "成交账单不完整时，交易净收益差异会被放大。";
    case "realized_pnl":
      return completeness.fills_complete
        ? "已实现盈亏来自成交账单聚合。"
        : "成交账单缺失或截断，已实现盈亏只可作参考。";
    case "fees_paid":
      return completeness.fills_complete
        ? "手续费来自逐笔成交账单。"
        : "手续费账单不完整，可能低估实盘成本。";
    case "funding_net":
      return completeness.funding_complete
        ? "资金费净额来自交易所账单汇总。"
        : "资金费账单不完整或被裁剪，净额可能偏差较大。";
    case "position_notional":
      return "持仓名义价值反映回测末仓位与当前实盘仓位是否同量级。";
    case "active_levels":
      return snapshot.inferred_grid.confidence >= 0.55
        ? "活跃层数来自当前挂单和持仓推断。"
        : "推断网格置信度不足，活跃层数仅供参考。";
    default:
      return "该指标用于辅助判断账单与回测的结构性差异。";
  }
}

export function buildLiveComparison({ request, result, snapshot }: Params): LiveComparisonSummary {
  if (!snapshot) {
    return {
      blocked: true,
      issues: ["尚未获取实盘快照。"],
      metrics: [],
      reasons: ["先同步实盘账单，再生成对账结果。"]
    };
  }

  if (!result) {
    return {
      blocked: true,
      issues: ["当前还没有回测结果，先运行一次回测后再做实盘对照。"],
      metrics: [],
      reasons: ["模块默认只和当前内存中的最近一次回测结果比较。"]
    };
  }

  const issues: string[] = [];
  const windowInfo = snapshot.window ?? {
    strategy_started_at: snapshot.account.strategy_started_at,
    fetched_at: snapshot.account.fetched_at,
    compared_end_at: snapshot.account.fetched_at
  };
  const completeness = snapshot.completeness ?? {
    fills_complete: false,
    funding_complete: false,
    bills_window_clipped: false,
    partial_failures: []
  };
  const ledgerSummary = snapshot.ledger_summary ?? {
    trading_net: snapshot.summary.total_pnl - snapshot.summary.unrealized_pnl - snapshot.summary.funding_net,
    fees: snapshot.summary.fees_paid,
    funding: snapshot.summary.funding_net,
    total_pnl: snapshot.summary.total_pnl,
    realized: snapshot.summary.realized_pnl,
    unrealized: snapshot.summary.unrealized_pnl
  };
  if (normalizeSymbol(request.data.symbol) !== normalizeSymbol(snapshot.account.symbol)) {
    issues.push(`回测标的 ${request.data.symbol} 与实盘标的 ${snapshot.account.symbol} 不一致。`);
  }

  if (snapshot.position.side !== "flat" && snapshot.position.side !== request.strategy.side) {
    issues.push(`回测方向 ${request.strategy.side} 与当前实盘持仓方向 ${snapshot.position.side} 不一致。`);
  }

  const requestStart = request.data.start_time ? Date.parse(request.data.start_time) : Number.NaN;
  const liveStart = Date.parse(windowInfo.strategy_started_at);
  if (Number.isFinite(requestStart) && Number.isFinite(liveStart) && Math.abs(requestStart - liveStart) > 5 * 60 * 1000) {
    issues.push("回测起点与实盘收益统计起点不一致，收益差异只可作参考。");
  }

  const requestEnd = request.data.end_time ? Date.parse(request.data.end_time) : Number.NaN;
  const comparedEnd = Date.parse(windowInfo.compared_end_at);
  if (!request.data.end_time) {
    issues.push("回测结果没有固定结束时间，请先按实盘时间窗重跑回测。");
  } else if (Number.isFinite(requestEnd) && Number.isFinite(comparedEnd) && Math.abs(requestEnd - comparedEnd) > 5 * 60 * 1000) {
    issues.push("回测结束时间与当前实盘快照时间不一致，请先按实盘时间窗重跑回测。");
  }

  const reasons: string[] = [];
  pushReason(reasons, !completeness.fills_complete, "成交账单不完整，已实现盈亏和手续费可能低估。");
  pushReason(reasons, !completeness.funding_complete, "资金费账单不完整，资金费净额可能失真。");
  pushReason(reasons, completeness.bills_window_clipped, "交易所账单窗口被裁剪，建议缩短起始时间。");
  pushReason(reasons, snapshot.inferred_grid.confidence < 0.55, "当前推断网格置信度不足，活跃层数和区间仅供参考。");

  if (issues.length > 0) {
    return {
      blocked: true,
      issues,
      metrics: [],
      reasons: reasons.length > 0 ? reasons : issues
    };
  }

  const backtestFees = result.summary.fees_paid;
  const backtestFunding = result.summary.funding_net;
  const backtestUnrealized = latestCurveValue(result, "unrealized_pnl_curve", 0);
  const backtestRealized = realizedGross(result);
  const backtestTotal = result.summary.total_return_usdt;
  const backtestTradingNet = tradingNetExcludingFunding(result);
  const backtestPositionNotional =
    latestCurveValue(result, "leverage_usage_curve", 0) * latestCurveValue(result, "equity_curve", result.summary.final_equity);
  const backtestActiveLevels = latestOpenPositions(result);
  const liveTradingNet = ledgerSummary.trading_net;

  const rawMetrics: LiveComparisonMetric[] = [
    {
      key: "total_pnl",
      label: "总收益（同口径）",
      backtest_value: backtestTotal,
      live_value: ledgerSummary.total_pnl,
      diff_value: ledgerSummary.total_pnl - backtestTotal,
      explanation: explainMetric("total_pnl", snapshot)
    },
    {
      key: "trading_net",
      label: "交易净收益",
      backtest_value: backtestTradingNet,
      live_value: liveTradingNet,
      diff_value: liveTradingNet - backtestTradingNet,
      explanation: explainMetric("trading_net", snapshot)
    },
    {
      key: "realized_pnl",
      label: "已实现盈亏",
      backtest_value: backtestRealized,
      live_value: snapshot.summary.realized_pnl,
      diff_value: snapshot.summary.realized_pnl - backtestRealized,
      explanation: explainMetric("realized_pnl", snapshot)
    },
    {
      key: "unrealized_pnl",
      label: "未实现盈亏",
      backtest_value: backtestUnrealized,
      live_value: snapshot.summary.unrealized_pnl,
      diff_value: snapshot.summary.unrealized_pnl - backtestUnrealized,
      explanation: explainMetric("unrealized_pnl", snapshot)
    },
    {
      key: "fees_paid",
      label: "手续费",
      backtest_value: backtestFees,
      live_value: snapshot.summary.fees_paid,
      diff_value: snapshot.summary.fees_paid - backtestFees,
      explanation: explainMetric("fees_paid", snapshot)
    },
    {
      key: "funding_net",
      label: "资金费净额",
      backtest_value: backtestFunding,
      live_value: snapshot.summary.funding_net,
      diff_value: snapshot.summary.funding_net - backtestFunding,
      explanation: explainMetric("funding_net", snapshot)
    },
    {
      key: "position_notional",
      label: "持仓名义价值",
      backtest_value: backtestPositionNotional,
      live_value: snapshot.summary.position_notional,
      diff_value: snapshot.summary.position_notional - backtestPositionNotional,
      explanation: explainMetric("position_notional", snapshot)
    },
    {
      key: "active_levels",
      label: "活跃层数",
      backtest_value: backtestActiveLevels,
      live_value: snapshot.inferred_grid.active_level_count,
      diff_value: snapshot.inferred_grid.active_level_count - backtestActiveLevels,
      explanation: explainMetric("active_levels", snapshot)
    }
  ];

  const metrics: LiveComparisonMetric[] = [...rawMetrics].sort(
    (left, right) => Math.abs(right.diff_value) - Math.abs(left.diff_value)
  );

  pushReason(
    reasons,
    Math.abs(snapshot.summary.position_notional - backtestPositionNotional) > Math.max(100, backtestPositionNotional * 0.15),
    "当前实盘持仓名义价值与回测末仓位不在同一量级。"
  );

  return {
    blocked: false,
    issues: [],
    metrics,
    reasons
  };
}
