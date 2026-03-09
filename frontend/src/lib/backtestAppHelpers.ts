import { BacktestRequest, BacktestResponse, OptimizationConfig, StrategyConfig, SweepRange } from "../types";
import { buildGridNodes, deriveBasePositionGridIndices as sharedDeriveBasePositionGridIndices } from "./gridLogic";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function exportBacktestResultCsv(result: BacktestResponse, request?: BacktestRequest): void {
  const lines: string[] = [];

  if (request) {
    lines.push("section,key,value");
    Object.entries(request.strategy).forEach(([key, value]) => {
      lines.push(["strategy", key, csvEscape(value)].join(","));
    });
    Object.entries(request.data).forEach(([key, value]) => {
      lines.push(["data", key, csvEscape(value)].join(","));
    });
    lines.push("");
  }

  lines.push("section,key,value");
  Object.entries(result.summary).forEach(([key, value]) => {
    lines.push(["summary", key, csvEscape(value)].join(","));
  });

  if (result.analysis) {
    Object.entries(result.analysis).forEach(([key, value]) => {
      lines.push(["analysis", key, csvEscape(Array.isArray(value) ? value.join("|") : value)].join(","));
    });
  }
  if (result.scoring) {
    Object.entries(result.scoring).forEach(([key, value]) => {
      lines.push(["scoring", key, csvEscape(Array.isArray(value) ? value.join("|") : value)].join(","));
    });
  }

  lines.push("", "events,timestamp,event_type,price,message");
  result.events.forEach((event) => {
    lines.push(
      [
        "event",
        csvEscape(event.timestamp),
        csvEscape(event.event_type),
        csvEscape(event.price),
        csvEscape(event.message)
      ].join(",")
    );
  });

  lines.push(
    "",
    "trades,open_time,close_time,side,entry_price,exit_price,quantity,gross_pnl,net_pnl,fee_paid,holding_hours,close_reason"
  );
  result.trades.forEach((trade) => {
    lines.push(
      [
        "trade",
        csvEscape(trade.open_time),
        csvEscape(trade.close_time),
        csvEscape(trade.side),
        csvEscape(trade.entry_price),
        csvEscape(trade.exit_price),
        csvEscape(trade.quantity),
        csvEscape(trade.gross_pnl),
        csvEscape(trade.net_pnl),
        csvEscape(trade.fee_paid),
        csvEscape(trade.holding_hours),
        csvEscape(trade.close_reason)
      ].join(",")
    );
  });

  lines.push("", "equity,timestamp,equity");
  result.equity_curve.forEach((point) => {
    lines.push(["equity", csvEscape(point.timestamp), csvEscape(point.value)].join(","));
  });

  lines.push("", "drawdown,timestamp,value");
  result.drawdown_curve.forEach((point) => {
    lines.push(["drawdown", csvEscape(point.timestamp), csvEscape(point.value)].join(","));
  });

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  link.setAttribute("href", url);
  link.setAttribute("download", `btc-grid-backtest-${ts}.csv`);
  link.click();
  URL.revokeObjectURL(url);
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Math.floor(value / step + 1e-12) * step;
}

function entryFeeRate(strategy: StrategyConfig, asBasePosition: boolean): number {
  if (asBasePosition) {
    return Number(strategy.taker_fee_rate ?? strategy.fee_rate ?? 0);
  }
  return Number(strategy.maker_fee_rate ?? strategy.fee_rate ?? 0);
}

function stopCloseFeeRate(strategy: StrategyConfig): number {
  return Number(strategy.taker_fee_rate ?? strategy.fee_rate ?? 0);
}

function applyOpenSlippage(side: StrategyConfig["side"], level: number, slippage: number): number {
  return side === "long" ? level * (1 + slippage) : level * (1 - slippage);
}

function applyCloseSlippage(side: StrategyConfig["side"], level: number, slippage: number): number {
  return side === "long" ? level * (1 - slippage) : level * (1 + slippage);
}

function deriveBaseGridIndices(strategy: StrategyConfig, currentPrice: number, nodes: number[], eps: number): number[] {
  return sharedDeriveBasePositionGridIndices({
    side: strategy.side,
    useBasePosition: strategy.use_base_position,
    currentPrice,
    nodes,
    eps
  });
}

function resolveInitialAndGrid(strategy: StrategyConfig, initialPrice?: number): {
  safeGrids: number;
  orderNotional: number;
  minNotional: number;
  assumedInitial: number;
  nodes: number[];
  eps: number;
} | null {
  const safeGrids = Number(strategy.grids || 0);
  const safeMargin = Number(strategy.margin || 0);
  const safeLeverage = Number(strategy.leverage || 0);
  if (
    !Number.isFinite(safeGrids) ||
    safeGrids <= 0 ||
    !Number.isFinite(safeMargin) ||
    safeMargin <= 0 ||
    !Number.isFinite(safeLeverage) ||
    safeLeverage <= 0
  ) {
    return null;
  }

  const orderNotional = (safeMargin * safeLeverage) / safeGrids;
  const minNotional = Number(strategy.min_notional ?? 0);
  if (orderNotional <= 0 || orderNotional < minNotional) {
    return null;
  }

  const lower = Number(strategy.lower);
  const upper = Number(strategy.upper);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
    return null;
  }
  const { nodes, eps } = buildGridNodes(lower, upper, safeGrids);
  if (nodes.length !== safeGrids + 1) {
    return null;
  }

  const assumedInitial = Number.isFinite(initialPrice ?? Number.NaN) ? Number(initialPrice) : (lower + upper) / 2;
  if (!Number.isFinite(assumedInitial) || assumedInitial <= 0) {
    return null;
  }

  return {
    safeGrids,
    orderNotional,
    minNotional,
    assumedInitial,
    nodes,
    eps
  };
}

type WorstCaseLeg = {
  entryPrice: number;
  quantity: number;
  entryFee: number;
};

function buildWorstCaseLegs(strategy: StrategyConfig, initialPrice?: number): WorstCaseLeg[] {
  const resolved = resolveInitialAndGrid(strategy, initialPrice);
  if (!resolved) {
    return [];
  }
  const { safeGrids, orderNotional, minNotional, assumedInitial, nodes, eps } = resolved;

  const baseIndices = deriveBaseGridIndices(strategy, assumedInitial, nodes, eps);
  const seen = new Set<number>();
  const entries: Array<{ base: boolean; rawEntry: number }> = [];

  for (const idx of baseIndices) {
    if (seen.has(idx)) {
      continue;
    }
    seen.add(idx);
    entries.push({ base: true, rawEntry: assumedInitial });
  }

  if (strategy.side === "long") {
    for (let idx = 0; idx < safeGrids; idx += 1) {
      if (seen.has(idx)) {
        continue;
      }
      const openLevel = nodes[idx];
      if (openLevel < assumedInitial - eps) {
        seen.add(idx);
        entries.push({ base: false, rawEntry: openLevel });
      }
    }
  } else {
    for (let idx = 0; idx < safeGrids; idx += 1) {
      if (seen.has(idx)) {
        continue;
      }
      const openLevel = nodes[idx + 1];
      if (openLevel > assumedInitial + eps) {
        seen.add(idx);
        entries.push({ base: false, rawEntry: openLevel });
      }
    }
  }

  if (entries.length === 0) {
    return [];
  }

  const slippage = Number(strategy.slippage ?? 0);
  const priceTick = Number(strategy.price_tick_size ?? 0);
  const legs: WorstCaseLeg[] = [];

  for (const entry of entries) {
    let entryPrice = applyOpenSlippage(strategy.side, entry.rawEntry, slippage);
    entryPrice = roundToStep(entryPrice, priceTick);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      continue;
    }
    let quantity = orderNotional / entryPrice;
    quantity = floorToStep(quantity, Number(strategy.quantity_step_size ?? 0));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    const entryNotional = Math.abs(entryPrice * quantity);
    if (entryNotional < minNotional) {
      continue;
    }
    const openFee = entryNotional * entryFeeRate(strategy, entry.base);
    legs.push({ entryPrice, quantity, entryFee: openFee });
  }

  return legs;
}

export function estimateInitialAverageEntryAndLiquidationPrice(
  strategy: StrategyConfig,
  initialPrice?: number
): { averageEntryPrice: number | null; estimatedLiquidationPrice: number | null } {
  const legs = buildWorstCaseLegs(strategy, initialPrice);
  if (legs.length === 0) {
    return { averageEntryPrice: null, estimatedLiquidationPrice: null };
  }

  const totalQty = legs.reduce((sum, leg) => sum + leg.quantity, 0);
  if (!Number.isFinite(totalQty) || totalQty <= 0) {
    return { averageEntryPrice: null, estimatedLiquidationPrice: null };
  }

  const averageEntryPrice = legs.reduce((sum, leg) => sum + leg.entryPrice * leg.quantity, 0) / totalQty;
  if (!Number.isFinite(averageEntryPrice) || averageEntryPrice <= 0) {
    return { averageEntryPrice: null, estimatedLiquidationPrice: null };
  }

  const totalNotional = totalQty * averageEntryPrice;
  if (!Number.isFinite(totalNotional) || totalNotional <= 0) {
    return { averageEntryPrice, estimatedLiquidationPrice: null };
  }

  const totalEntryFees = legs.reduce((sum, leg) => sum + leg.entryFee, 0);
  const effectiveMargin = Math.max(0, Number(strategy.margin ?? 0) - totalEntryFees);
  const maintenanceMargin = Math.max(0, Number(strategy.maintenance_margin_rate ?? 0) * totalNotional);
  const marginBuffer = Math.max(0, effectiveMargin - maintenanceMargin);
  const liquidationRaw =
    strategy.side === "long"
      ? averageEntryPrice * (1 - marginBuffer / totalNotional)
      : averageEntryPrice * (1 + marginBuffer / totalNotional);

  return {
    averageEntryPrice,
    estimatedLiquidationPrice:
      Number.isFinite(liquidationRaw) && liquidationRaw > 0 ? liquidationRaw : null
  };
}

export function estimateMaxPossibleLossAtStop(strategy: StrategyConfig, initialPrice?: number): number {
  const legs = buildWorstCaseLegs(strategy, initialPrice);
  if (legs.length === 0) {
    return 0;
  }

  const slippage = Number(strategy.slippage ?? 0);
  const priceTick = Number(strategy.price_tick_size ?? 0);
  let exitPrice = applyCloseSlippage(strategy.side, Number(strategy.stop_loss), slippage);
  exitPrice = roundToStep(exitPrice, priceTick);
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    exitPrice = Math.max(Number(strategy.stop_loss), 1e-9);
  }

  const closeFeeRate = stopCloseFeeRate(strategy);
  let totalNet = 0;
  for (const leg of legs) {
    const closeNotional = Math.abs(exitPrice * leg.quantity);
    const closeFeePaid = closeNotional * closeFeeRate;
    const gross =
      strategy.side === "long"
        ? (exitPrice - leg.entryPrice) * leg.quantity
        : (leg.entryPrice - exitPrice) * leg.quantity;
    totalNet += gross - leg.entryFee - closeFeePaid;
  }

  return Math.max(0, -totalNet);
}

export function cloneBacktestRequest(request: BacktestRequest): BacktestRequest {
  return {
    strategy: { ...request.strategy },
    data: { ...request.data }
  };
}

export function buildBacktestPrecheck(
  request: BacktestRequest,
  initialPriceForRisk?: number,
  estimatedLiquidationPriceForRisk?: number,
  options?: {
    forceRiskGuards?: boolean;
    requireMaxLossInput?: boolean;
    forceMaxLossGuard?: boolean;
  }
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const applyRiskGuards = Boolean(options?.forceRiskGuards) || request.strategy.strict_risk_control;
  const requireMaxLossInput = Boolean(options?.requireMaxLossInput);
  const applyMaxLossGuard = Boolean(options?.forceMaxLossGuard) || applyRiskGuards;
  const side = request.strategy.side;
  const {
    lower,
    upper,
    stop_loss,
    leverage,
    grids,
    margin,
    maintenance_margin_rate,
    use_base_position,
    max_allowed_loss_usdt
  } = request.strategy;

  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
    errors.push("区间参数无效：UPPER 必须大于 LOWER。");
  }
  if (!Number.isFinite(grids) || grids < 2) {
    errors.push("网格数量必须大于等于 2。");
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    errors.push("杠杆必须大于 0。");
  }
  if (!Number.isFinite(margin) || margin <= 0) {
    errors.push("保证金必须大于 0。");
  }
  if (side === "short" && stop_loss <= upper) {
    errors.push("做空网格的 STOP_LOSS 必须高于 UPPER。");
  }
  if (side === "long" && stop_loss >= lower) {
    errors.push("做多网格的 STOP_LOSS 必须低于 LOWER。");
  }

  const startTs = parseIso(request.data.start_time ?? null);
  const endTs = parseIso(request.data.end_time ?? null);
  if (startTs !== null && endTs !== null && startTs >= endTs) {
    errors.push("开始时间必须早于结束时间。");
  }

  const stopDistancePct =
    side === "short"
      ? upper > 0
        ? ((stop_loss - upper) / upper) * 100
        : 0
      : lower > 0
      ? ((lower - stop_loss) / lower) * 100
      : 0;
  if (Number.isFinite(stopDistancePct) && stopDistancePct > 0 && stopDistancePct < 0.8) {
    warnings.push("止损距离较窄（<0.8%），容易被短期波动触发。");
  }
  if (leverage > 15) {
    warnings.push("当前杠杆 > 15，风险偏高。");
  }
  if (maintenance_margin_rate >= 0.01) {
    warnings.push("维持保证金率较高，会提高强平触发概率。");
  }
  if (use_base_position) {
    const potentialBaseGrids = Math.max(grids - 2, 0);
    const potentialBaseNotional = (margin * leverage * potentialBaseGrids) / Math.max(grids, 1);
    if (potentialBaseGrids >= 4 || potentialBaseNotional >= margin * leverage * 0.6) {
      warnings.push("开底仓后潜在初始底仓规模偏大，请确认仓位承受能力。");
    }
  }

  if (applyRiskGuards && Number.isFinite(estimatedLiquidationPriceForRisk)) {
    const estimatedLiq = Number(estimatedLiquidationPriceForRisk);
    if (side === "short" && !(upper < stop_loss && stop_loss < estimatedLiq)) {
      errors.push(
        `止损/强平约束不满足：做空需满足 UPPER < STOP_LOSS < 预估强平价（${estimatedLiq.toFixed(
          2
        )}）。请先调整止损价或仓位。`
      );
    }
    if (side === "long" && !(estimatedLiq < stop_loss && stop_loss < lower)) {
      errors.push(
        `止损/强平约束不满足：做多需满足 预估强平价（${estimatedLiq.toFixed(
          2
        )}） < STOP_LOSS < LOWER。请先调整止损价或仓位。`
      );
    }
  }

  const maxLossValid = Number.isFinite(max_allowed_loss_usdt) && Number(max_allowed_loss_usdt) > 0;
  if (requireMaxLossInput && !maxLossValid) {
    errors.push("最大亏损数额为必填项，且必须大于 0。");
  }

  if (applyMaxLossGuard) {
    if (!maxLossValid) {
      if (!requireMaxLossInput) {
        errors.push("最大亏损数额必须大于 0。");
      }
    } else {
      const maxLossLimit = Number(max_allowed_loss_usdt);
      const estimatedMaxLoss = estimateMaxPossibleLossAtStop(request.strategy, initialPriceForRisk);
      if (estimatedMaxLoss > maxLossLimit) {
        errors.push(
          `以损定仓约束不满足：预计止损最大可能亏损 ${estimatedMaxLoss.toFixed(2)} USDT > 上限 ${maxLossLimit.toFixed(
            2
          )} USDT。请降低杠杆/保证金，或提高最大亏损数额。`
        );
      }
    }
  }

  if (!applyRiskGuards) {
    if (applyMaxLossGuard) {
      warnings.push("严格风控已关闭：将忽略止损/强平约束，但仍会校验最大亏损上限。");
    } else {
      warnings.push("严格风控已关闭：将忽略止损/强平与最大亏损约束，仅用于回测试验。");
    }
  }

  return { errors, warnings };
}

function estimateSweepCount(sweep: SweepRange): number {
  if (!sweep.enabled) {
    return 1;
  }
  if (sweep.values && sweep.values.length > 0) {
    return sweep.values.length;
  }
  if (sweep.start === null || sweep.end === null || sweep.step === null) {
    return 0;
  }
  if (sweep.step <= 0 || sweep.end < sweep.start) {
    return 0;
  }
  return Math.floor((sweep.end - sweep.start) / sweep.step + 1e-9) + 1;
}

export function buildOptimizationPrecheck(
  request: BacktestRequest,
  optimization: OptimizationConfig,
  initialPriceForRisk?: number,
  options?: {
    requireMaxLossInput?: boolean;
    forceMaxLossGuard?: boolean;
  }
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const baseCheck = buildBacktestPrecheck(
    request,
    initialPriceForRisk,
    undefined,
    options
      ? {
          requireMaxLossInput: Boolean(options.requireMaxLossInput),
          forceMaxLossGuard: Boolean(options.forceMaxLossGuard)
        }
      : undefined
  );
  errors.push(...baseCheck.errors);
  warnings.push(...baseCheck.warnings);

  const leverageCount = estimateSweepCount(optimization.leverage);
  const gridsCount = estimateSweepCount(optimization.grids);
  const widthCount = estimateSweepCount(optimization.band_width_pct);
  const stopCount = estimateSweepCount(optimization.stop_loss_ratio_pct);
  const baseCount = optimization.optimize_base_position ? 2 : 1;
  const spaceSize = leverageCount * gridsCount * widthCount * stopCount * baseCount;

  if (spaceSize <= 0) {
    errors.push("参数扫描范围无效，请检查开始/结束/步长。");
  }
  if (
    optimization.optimization_mode === "grid" &&
    spaceSize > optimization.max_combinations &&
    !optimization.auto_limit_combinations
  ) {
    errors.push("Grid 模式预计组合超过上限，且未开启自动抽样。");
  }
  if (optimization.optimization_mode !== "grid" && optimization.max_trials < 1) {
    errors.push("试验数必须大于 0。");
  }
  if (
    optimization.anchor_mode === "CUSTOM_PRICE" &&
    (!optimization.custom_anchor_price || optimization.custom_anchor_price <= 0)
  ) {
    errors.push("Anchor 模式为 CUSTOM_PRICE 时必须输入有效价格。");
  }
  if (spaceSize > 100000) {
    warnings.push(`当前参数空间 ${spaceSize.toLocaleString()} 组，建议缩小范围或启用剪枝。`);
  }
  if (optimization.max_allowed_loss_usdt !== null && optimization.max_allowed_loss_usdt !== undefined) {
    warnings.push("已启用“最大亏损上限”筛选，若可行组合过少请调整杠杆/保证金或提高亏损上限。");
  }
  if (!optimization.require_positive_return) {
    warnings.push("未启用正收益约束，结果中可能出现负收益组合。");
  }
  if (optimization.max_drawdown_pct_limit === null) {
    warnings.push("未设置最大回撤约束，建议设置风控上限。");
  }
  if (optimization.optimization_mode === "bayesian" && optimization.max_trials > 5000) {
    warnings.push("Bayesian 试验数较大，建议开启自适应降级并使用“极速”计算模式。");
  }
  if (optimization.optimization_mode !== "grid" && optimization.max_workers <= 1) {
    warnings.push("当前并行进程数为 1，会显著降低优化速度。");
  }

  return { errors, warnings };
}
