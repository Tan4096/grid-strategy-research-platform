from __future__ import annotations

import csv
import io
import math
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import product
from typing import Any, Dict, List, Optional, Tuple

from app.core.optimization_schemas import (
    AnchorMode,
    HeatmapCell,
    OptimizationConfig,
    OptimizationJobMeta,
    OptimizationJobStatus,
    OptimizationMode,
    OptimizationProgressPoint,
    OptimizationTarget,
    OptimizationRequest,
    OptimizationResultRow,
    OptimizationStartResponse,
    OptimizationStatusResponse,
    SortOrder,
    SweepRange,
    TimeWindowInfo,
)
from app.core.schemas import BacktestResult, Candle, CurvePoint, StrategyConfig
from app.optimizer.bayesian_optimizer import (
    BayesianDependencyError,
    BayesianTrialOutcome,
    TrialPruneSignal,
    run_bayesian_search,
    run_random_pruned_search,
)
from app.optimizer.parallel_runner import run_combinations_parallel
from app.optimizer.pruning import (
    build_pruning_checkpoints,
    estimate_theoretical_grid_profit,
    infer_liquidation_from_compact_run,
    score_upper_bound_with_remaining,
    should_prune_by_drawdown,
    should_prune_by_profit_ceiling,
)
from app.optimizer.scoring import compute_return_drawdown_ratio, compute_score, compute_sharpe_ratio_from_values
from app.services.backtest_engine import run_backtest, run_backtest_for_optimization
from app.services.data_loader import load_candles


@dataclass
class _JobRecord:
    meta: OptimizationJobMeta
    target: OptimizationTarget
    rows: List[OptimizationResultRow] = field(default_factory=list)
    best_row: Optional[OptimizationResultRow] = None
    best_validation_row: Optional[OptimizationResultRow] = None
    best_equity_curve: List[CurvePoint] = field(default_factory=list)
    best_score_progression: List[OptimizationProgressPoint] = field(default_factory=list)
    convergence_curve_data: List[OptimizationProgressPoint] = field(default_factory=list)
    train_window: Optional[TimeWindowInfo] = None
    validation_window: Optional[TimeWindowInfo] = None


_JOB_LOCK = threading.Lock()
_JOBS: Dict[str, _JobRecord] = {}


def _normalize_pct(value: float) -> float:
    # Optimization ranges are percentage inputs (e.g. 5 => 5%).
    return value / 100.0


def _round_price(value: float) -> float:
    return float(f"{float(value):.2f}")


def _resolve_anchor_price(candles: List[Candle], optimization: OptimizationConfig) -> float:
    if not candles:
        raise ValueError("cannot resolve anchor price from empty candles")

    if optimization.anchor_mode == AnchorMode.BACKTEST_START_PRICE:
        anchor_price = candles[0].close
    elif optimization.anchor_mode == AnchorMode.BACKTEST_AVG_PRICE:
        anchor_price = sum(candle.close for candle in candles) / len(candles)
    elif optimization.anchor_mode == AnchorMode.CURRENT_PRICE:
        anchor_price = candles[-1].close
    elif optimization.anchor_mode == AnchorMode.CUSTOM_PRICE:
        if optimization.custom_anchor_price is None:
            raise ValueError("custom_anchor_price is required when anchor_mode=CUSTOM_PRICE")
        anchor_price = optimization.custom_anchor_price
    else:  # pragma: no cover - exhaustive guard for future enum values
        raise ValueError(f"unsupported anchor_mode: {optimization.anchor_mode}")

    if anchor_price <= 0:
        raise ValueError("anchor price must be > 0")

    return _round_price(anchor_price)


def _expand_sweep(sweep: SweepRange, integer_mode: bool = False) -> List[float]:
    if not sweep.enabled:
        return []

    if sweep.values and len(sweep.values) > 0:
        values = [float(v) for v in sweep.values]
    else:
        if sweep.start is None or sweep.end is None or sweep.step is None:
            raise ValueError("invalid sweep range")
        values = []
        cursor = float(sweep.start)
        end = float(sweep.end)
        step = float(sweep.step)
        while cursor <= end + (step * 1e-6):
            values.append(round(cursor, 10))
            cursor += step

    if integer_mode:
        return sorted({int(round(v)) for v in values})
    return sorted({float(v) for v in values})


def _derive_band_width_pct(lower: float, upper: float, center_price: float) -> float:
    if center_price <= 0:
        return 0.0
    return ((upper - lower) / (2 * center_price)) * 100.0


def _derive_stop_loss_ratio_pct(strategy: StrategyConfig) -> float:
    if strategy.side.value == "short" and strategy.upper > 0:
        return ((strategy.stop_loss / strategy.upper) - 1.0) * 100.0
    if strategy.side.value == "long" and strategy.lower > 0:
        return (1.0 - (strategy.stop_loss / strategy.lower)) * 100.0
    return 0.0


def _open_fill_price(side: str, raw_level: float, slippage: float) -> float:
    if side == "long":
        return raw_level * (1.0 + slippage)
    return raw_level * (1.0 - slippage)


def _grid_nodes_with_cache(
    lower: float,
    upper: float,
    grids: int,
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]],
) -> Tuple[List[float], float]:
    cache_key = (float(lower), float(upper), int(grids))
    cached = node_cache.get(cache_key)
    if cached is not None:
        return cached

    grid_size = (upper - lower) / grids
    nodes = [lower + (i * grid_size) for i in range(grids + 1)]
    eps = max(abs(grid_size) * 1e-9, 1e-8)
    node_cache[cache_key] = (nodes, eps)
    return nodes, eps


def _derive_base_position_grid_indices(
    strategy: StrategyConfig,
    current_price: float,
    nodes: Optional[List[float]] = None,
    eps: Optional[float] = None,
) -> List[int]:
    if not strategy.use_base_position:
        return []

    if nodes is None or eps is None:
        grid_size = (strategy.upper - strategy.lower) / strategy.grids
        nodes = [strategy.lower + (i * grid_size) for i in range(strategy.grids + 1)]
        eps = max(abs(grid_size) * 1e-9, 1e-8)

    on_node = any(abs(node - current_price) <= eps for node in nodes)
    offset = 1 if on_node else 2

    if strategy.side.value == "long":
        k = sum(1 for node in nodes if node > current_price + eps)
        base_grid_count = max(k - offset, 0)
        first_above_idx = next((idx for idx, node in enumerate(nodes) if node > current_price + eps), len(nodes))
        grid_indices = list(range(first_above_idx, min(strategy.grids, first_above_idx + base_grid_count)))
    else:
        k = sum(1 for node in nodes if node < current_price - eps)
        base_grid_count = max(k - offset, 0)
        grid_indices = list(range(1, min(strategy.grids, 1 + base_grid_count)))

    base_grid_count = max(0, min(base_grid_count, len(grid_indices)))
    return grid_indices[:base_grid_count]


def _derive_base_position_info(
    strategy: StrategyConfig,
    current_price: float,
    nodes: Optional[List[float]] = None,
    eps: Optional[float] = None,
) -> Tuple[int, float]:
    grid_indices = _derive_base_position_grid_indices(strategy, current_price, nodes=nodes, eps=eps)
    if not grid_indices:
        return 0, 0.0

    base_grid_count = len(grid_indices)
    total_nominal = strategy.margin * strategy.leverage
    position_per_grid = total_nominal / strategy.grids
    initial_position_size = position_per_grid * base_grid_count
    return int(base_grid_count), float(initial_position_size)


def _estimate_initial_avg_entry_and_liquidation(
    strategy: StrategyConfig,
    current_price: float,
    grid_lines: Optional[List[float]] = None,
    eps: Optional[float] = None,
    base_grid_indices: Optional[List[int]] = None,
) -> Tuple[Optional[float], Optional[float]]:
    if grid_lines is None or eps is None:
        grid_size = (strategy.upper - strategy.lower) / strategy.grids
        grid_lines = [strategy.lower + (i * grid_size) for i in range(strategy.grids + 1)]
        eps = max(abs(grid_size) * 1e-9, 1e-8)

    order_notional = strategy.margin * strategy.leverage / strategy.grids
    opened_indices: set[int] = set()
    positions: List[Tuple[float, float]] = []

    def add_position(grid_index: int, raw_open_level: float) -> None:
        if grid_index in opened_indices:
            return
        opened_indices.add(grid_index)
        entry_price = _open_fill_price(strategy.side.value, raw_open_level, strategy.slippage)
        if entry_price <= 0:
            return
        quantity = order_notional / entry_price
        if quantity <= 0:
            return
        positions.append((entry_price, quantity))

    # Base positions are market-filled at the first candle close.
    effective_base_indices = (
        base_grid_indices
        if base_grid_indices is not None
        else _derive_base_position_grid_indices(strategy, current_price, nodes=grid_lines, eps=eps)
    )
    for grid_index in effective_base_indices:
        add_position(grid_index, current_price)

    # Estimate adverse move to stop-loss: open any additional grids crossed
    # before the stop trigger.
    if strategy.side.value == "long":
        for grid_index in range(strategy.grids):
            open_level = grid_lines[grid_index]
            if open_level < current_price - eps:
                add_position(grid_index, open_level)
    else:
        for grid_index in range(strategy.grids):
            open_level = grid_lines[grid_index + 1]
            if open_level > current_price + eps:
                add_position(grid_index, open_level)

    if not positions:
        return None, None

    total_qty = sum(quantity for _, quantity in positions)
    if total_qty <= 0:
        return None, None

    avg_entry = sum(entry_price * quantity for entry_price, quantity in positions) / total_qty
    if avg_entry <= 0:
        return None, None

    total_notional = total_qty * avg_entry
    if total_notional <= 0:
        return None, None

    estimated_entry_fees = len(positions) * order_notional * strategy.fee_rate
    effective_margin = max(strategy.margin - estimated_entry_fees, 0.0)
    maintenance_margin = strategy.maintenance_margin_rate * total_notional
    margin_buffer = max(effective_margin - maintenance_margin, 0.0)

    if strategy.side.value == "long":
        liquidation_price = avg_entry * (1.0 - (margin_buffer / total_notional))
    else:
        liquidation_price = avg_entry * (1.0 + (margin_buffer / total_notional))

    if liquidation_price <= 0:
        return avg_entry, None

    return avg_entry, liquidation_price


@dataclass
class _ParameterSpace:
    leverage_values: List[float]
    grid_values: List[int]
    band_values: List[float]
    stop_ratio_values: List[float]
    base_position_values: List[bool]


def _resolve_parameter_space(
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
) -> _ParameterSpace:
    leverage_values = (
        _expand_sweep(optimization.leverage, integer_mode=False)
        if optimization.leverage.enabled
        else [base_strategy.leverage]
    )
    grid_values = _expand_sweep(optimization.grids, integer_mode=True) if optimization.grids.enabled else [base_strategy.grids]
    band_values = (
        _expand_sweep(optimization.band_width_pct, integer_mode=False)
        if optimization.band_width_pct.enabled
        else [_derive_band_width_pct(base_strategy.lower, base_strategy.upper, reference_price)]
    )
    stop_ratio_values = (
        _expand_sweep(optimization.stop_loss_ratio_pct, integer_mode=False)
        if optimization.stop_loss_ratio_pct.enabled
        else [_derive_stop_loss_ratio_pct(base_strategy)]
    )
    base_position_values = [False, True] if optimization.optimize_base_position else [base_strategy.use_base_position]

    return _ParameterSpace(
        leverage_values=[float(v) for v in leverage_values],
        grid_values=[int(v) for v in grid_values],
        band_values=[float(v) for v in band_values],
        stop_ratio_values=[float(v) for v in stop_ratio_values],
        base_position_values=[bool(v) for v in base_position_values],
    )


def _total_space_combinations(space: _ParameterSpace) -> int:
    return (
        len(space.leverage_values)
        * len(space.grid_values)
        * len(space.band_values)
        * len(space.stop_ratio_values)
        * len(space.base_position_values)
    )


def _is_effectively_integer(value: float) -> bool:
    return abs(float(value) - round(float(value))) <= 1e-9


def _suggest_from_sweep(
    trial: Any,
    *,
    name: str,
    sweep: SweepRange,
    fallback: float,
    integer_mode: bool,
) -> float:
    if not sweep.enabled:
        return float(int(round(fallback))) if integer_mode else float(fallback)

    if sweep.values and len(sweep.values) > 0:
        if integer_mode:
            choices = sorted({int(round(float(v))) for v in sweep.values})
        else:
            choices = sorted({float(v) for v in sweep.values})
        value = trial.suggest_categorical(name, choices)
        return float(int(value)) if integer_mode else float(value)

    if sweep.start is None or sweep.end is None or sweep.step is None:
        return float(int(round(fallback))) if integer_mode else float(fallback)

    if integer_mode:
        start = int(round(sweep.start))
        end = int(round(sweep.end))
        step = max(1, int(round(sweep.step)))
        return float(trial.suggest_int(name, start, end, step=step))

    if _is_effectively_integer(float(sweep.start)) and _is_effectively_integer(float(sweep.end)) and _is_effectively_integer(float(sweep.step)):
        start = int(round(sweep.start))
        end = int(round(sweep.end))
        step = max(1, int(round(sweep.step)))
        return float(trial.suggest_int(name, start, end, step=step))

    return float(trial.suggest_float(name, float(sweep.start), float(sweep.end), step=float(sweep.step)))


def _build_single_combo(
    *,
    row_id: int,
    base_strategy: StrategyConfig,
    reference_price: float,
    initial_price: float,
    leverage: float,
    grids: int,
    band_pct_raw: float,
    stop_ratio_raw: float,
    use_base_position: bool,
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]],
) -> Optional[dict]:
    band_ratio = _normalize_pct(float(band_pct_raw))
    stop_ratio = _normalize_pct(float(stop_ratio_raw))

    lower = _round_price(reference_price * (1.0 - band_ratio))
    upper = _round_price(reference_price * (1.0 + band_ratio))
    if lower <= 0 or upper <= lower:
        return None

    if base_strategy.side.value == "short":
        stop_loss = _round_price(upper * (1.0 + stop_ratio))
    else:
        stop_loss = _round_price(lower * (1.0 - stop_ratio))
    if stop_loss <= 0:
        return None

    nodes, eps = _grid_nodes_with_cache(float(lower), float(upper), int(grids), node_cache)
    strategy = base_strategy.model_copy(
        update={
            "leverage": float(leverage),
            "grids": int(grids),
            "lower": float(lower),
            "upper": float(upper),
            "stop_loss": float(stop_loss),
            "use_base_position": bool(use_base_position),
        }
    )
    base_grid_indices = _derive_base_position_grid_indices(
        strategy,
        current_price=initial_price,
        nodes=nodes,
        eps=eps,
    )

    _, estimated_liq_price = _estimate_initial_avg_entry_and_liquidation(
        strategy,
        current_price=initial_price,
        grid_lines=nodes,
        eps=eps,
        base_grid_indices=base_grid_indices,
    )
    if estimated_liq_price is None or estimated_liq_price <= 0:
        return None

    # Strict hard rule: stop-loss cannot violate potential liquidation boundary.
    if strategy.side.value == "short":
        if not (upper < stop_loss < estimated_liq_price):
            return None
    else:
        if not (estimated_liq_price < stop_loss < lower):
            return None

    if strategy.side.value == "short":
        effective_stop_ratio_pct = ((stop_loss / upper) - 1.0) * 100.0
    else:
        effective_stop_ratio_pct = (1.0 - (stop_loss / lower)) * 100.0

    base_grid_count, initial_position_size = _derive_base_position_info(
        strategy,
        current_price=initial_price,
        nodes=nodes,
        eps=eps,
    )

    return {
        "row_id": row_id,
        "strategy": strategy.model_dump(),
        "strategy_obj": strategy,
        "meta": {
            "leverage": float(leverage),
            "grids": int(grids),
            "use_base_position": bool(use_base_position),
            "base_grid_count": base_grid_count,
            "initial_position_size": float(initial_position_size),
            "anchor_price": _round_price(reference_price),
            "lower_price": float(lower),
            "upper_price": float(upper),
            "stop_price": float(stop_loss),
            "band_width_pct": band_ratio * 100.0,
            "range_lower": float(lower),
            "range_upper": float(upper),
            "stop_loss": float(stop_loss),
            "stop_loss_ratio_pct": float(effective_stop_ratio_pct),
        },
    }


def _build_combinations(
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
    initial_price: float,
) -> List[dict]:
    space = _resolve_parameter_space(base_strategy, optimization, reference_price)

    combos: List[dict] = []
    row_id = 1
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}

    for leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position in product(
        space.leverage_values, space.grid_values, space.band_values, space.stop_ratio_values, space.base_position_values
    ):
        combo = _build_single_combo(
            row_id=row_id,
            base_strategy=base_strategy,
            reference_price=reference_price,
            initial_price=initial_price,
            leverage=float(leverage),
            grids=int(grids),
            band_pct_raw=float(band_pct_raw),
            stop_ratio_raw=float(stop_ratio_raw),
            use_base_position=bool(use_base_position),
            node_cache=node_cache,
        )
        if combo is None:
            continue

        combos.append(combo)
        row_id += 1

    return combos


def _limit_combinations(combos: List[dict], max_count: int) -> List[dict]:
    if max_count <= 0:
        return []
    if len(combos) <= max_count:
        return combos
    if max_count == 1:
        selected = [combos[0]]
    else:
        last_index = len(combos) - 1
        ratio = last_index / (max_count - 1)
        seen = set()
        indices: List[int] = []
        for i in range(max_count):
            index = int(round(i * ratio))
            if index in seen:
                continue
            seen.add(index)
            indices.append(index)

        # Fill any gaps created by rounding duplicates.
        cursor = 0
        while len(indices) < max_count and cursor < len(combos):
            if cursor not in seen:
                seen.add(cursor)
                indices.append(cursor)
            cursor += 1

        indices.sort()
        selected = [combos[index] for index in indices[:max_count]]

    limited: List[dict] = []
    for row_id, combo in enumerate(selected, start=1):
        limited.append(
            {
                "row_id": row_id,
                "strategy": combo["strategy"],
                "meta": combo["meta"],
            }
        )
    return limited


def _split_walk_forward(candles: List[Candle], train_ratio: float) -> Tuple[List[Candle], List[Candle]]:
    split_idx = int(len(candles) * train_ratio)
    split_idx = max(2, min(split_idx, len(candles) - 2))
    return candles[:split_idx], candles[split_idx:]


def _window_info(candles: List[Candle]) -> TimeWindowInfo:
    return TimeWindowInfo(start_time=candles[0].timestamp, end_time=candles[-1].timestamp, candles=len(candles))


def _rows_by_id(rows: List[OptimizationResultRow]) -> Dict[int, OptimizationResultRow]:
    return {row.row_id: row for row in rows}


def _build_row_from_eval(combo: dict, eval_payload: dict) -> OptimizationResultRow:
    meta = combo["meta"]
    summary = eval_payload["summary"] if eval_payload.get("ok") else None

    if not summary:
        return OptimizationResultRow(
            row_id=int(combo["row_id"]),
            leverage=meta["leverage"],
            grids=meta["grids"],
            use_base_position=meta["use_base_position"],
            base_grid_count=meta["base_grid_count"],
            initial_position_size=meta["initial_position_size"],
            anchor_price=meta["anchor_price"],
            lower_price=meta["lower_price"],
            upper_price=meta["upper_price"],
            stop_price=meta["stop_price"],
            band_width_pct=meta["band_width_pct"],
            range_lower=meta["range_lower"],
            range_upper=meta["range_upper"],
            stop_loss=meta["stop_loss"],
            stop_loss_ratio_pct=meta["stop_loss_ratio_pct"],
            total_return_usdt=-1e12,
            max_drawdown_pct=1e12,
            sharpe_ratio=0.0,
            win_rate=0.0,
            return_drawdown_ratio=-1e12,
            score=float("-inf"),
            total_closed_trades=0,
        )

    return OptimizationResultRow(
        row_id=int(combo["row_id"]),
        leverage=meta["leverage"],
        grids=meta["grids"],
        use_base_position=meta["use_base_position"],
        base_grid_count=meta["base_grid_count"],
        initial_position_size=meta["initial_position_size"],
        anchor_price=meta["anchor_price"],
        lower_price=meta["lower_price"],
        upper_price=meta["upper_price"],
        stop_price=meta["stop_price"],
        band_width_pct=meta["band_width_pct"],
        range_lower=meta["range_lower"],
        range_upper=meta["range_upper"],
        stop_loss=meta["stop_loss"],
        stop_loss_ratio_pct=meta["stop_loss_ratio_pct"],
        total_return_usdt=float(summary["total_return_usdt"]),
        max_drawdown_pct=float(summary["max_drawdown_pct"]),
        sharpe_ratio=float(eval_payload["sharpe_ratio"]),
        win_rate=float(summary["win_rate"]),
        return_drawdown_ratio=float(eval_payload["return_drawdown_ratio"]),
        score=float(eval_payload["score"]),
        total_closed_trades=int(summary["total_closed_trades"]),
    )


def _evaluate_strategy_compact(
    *,
    candles: List[Candle],
    strategy: StrategyConfig,
    interval_value: str,
    target: OptimizationTarget,
    custom_score_expr: Optional[str],
    skip_sharpe: bool = False,
) -> dict:
    try:
        result = run_backtest_for_optimization(candles=candles, strategy=strategy)
        need_sharpe = (not skip_sharpe) or target in (OptimizationTarget.SHARPE, OptimizationTarget.CUSTOM)
        sharpe = compute_sharpe_ratio_from_values(result.equity_values, interval_value) if need_sharpe else 0.0
        total_return = float(result.summary["total_return_usdt"])
        max_drawdown = float(result.summary["max_drawdown_pct"])
        win_rate = float(result.summary["win_rate"])
        total_closed_trades = float(result.summary["total_closed_trades"])
        return_drawdown_ratio = compute_return_drawdown_ratio(total_return, max_drawdown)

        metrics = {
            "total_return_usdt": total_return,
            "max_drawdown_pct": max_drawdown,
            "sharpe_ratio": sharpe,
            "win_rate": win_rate,
            "return_drawdown_ratio": return_drawdown_ratio,
            "total_closed_trades": total_closed_trades,
        }
        score = compute_score(target, custom_score_expr, metrics)

        return {
            "ok": True,
            "summary": {
                "total_return_usdt": total_return,
                "max_drawdown_pct": max_drawdown,
                "win_rate": win_rate,
                "total_closed_trades": total_closed_trades,
            },
            "sharpe_ratio": sharpe,
            "return_drawdown_ratio": return_drawdown_ratio,
            "score": score,
            "equity_values_count": len(result.equity_values),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "summary": None,
            "sharpe_ratio": 0.0,
            "return_drawdown_ratio": 0.0,
            "score": float("-inf"),
            "equity_values_count": 0,
        }


def _evaluate_combo_compact(
    *,
    candles: List[Candle],
    combo: dict,
    interval_value: str,
    target: OptimizationTarget,
    custom_score_expr: Optional[str],
    skip_sharpe: bool = False,
) -> dict:
    strategy = StrategyConfig.model_validate(combo["strategy"])
    payload = _evaluate_strategy_compact(
        candles=candles,
        strategy=strategy,
        interval_value=interval_value,
        target=target,
        custom_score_expr=custom_score_expr,
        skip_sharpe=skip_sharpe,
    )
    payload["row_id"] = int(combo["row_id"])
    return payload


def _combo_signature(combo: dict) -> Tuple[Any, ...]:
    meta = combo["meta"]
    return (
        float(meta["leverage"]),
        int(meta["grids"]),
        float(meta["lower_price"]),
        float(meta["upper_price"]),
        float(meta["stop_price"]),
        bool(meta["use_base_position"]),
    )


def _safe_min(values: List[float], fallback: float) -> float:
    return min(values) if values else fallback


def _safe_max(values: List[float], fallback: float) -> float:
    return max(values) if values else fallback


def _generate_refine_combos(
    *,
    top_trials: List[BayesianTrialOutcome],
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
    initial_price: float,
    row_id_start: int,
    existing_signatures: set[Tuple[Any, ...]],
    parameter_space: _ParameterSpace,
) -> List[dict]:
    if not top_trials:
        return []

    leverage_min = _safe_min(parameter_space.leverage_values, base_strategy.leverage)
    leverage_max = _safe_max(parameter_space.leverage_values, base_strategy.leverage)
    grids_min = int(_safe_min([float(v) for v in parameter_space.grid_values], float(base_strategy.grids)))
    grids_max = int(_safe_max([float(v) for v in parameter_space.grid_values], float(base_strategy.grids)))
    band_min = _safe_min(parameter_space.band_values, _derive_band_width_pct(base_strategy.lower, base_strategy.upper, reference_price))
    band_max = _safe_max(parameter_space.band_values, _derive_band_width_pct(base_strategy.lower, base_strategy.upper, reference_price))
    stop_min = _safe_min(parameter_space.stop_ratio_values, _derive_stop_loss_ratio_pct(base_strategy))
    stop_max = _safe_max(parameter_space.stop_ratio_values, _derive_stop_loss_ratio_pct(base_strategy))

    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}
    refine_combos: List[dict] = []
    next_row_id = int(row_id_start)

    for outcome in top_trials:
        if outcome.combo is None:
            continue

        meta = outcome.combo["meta"]
        lev_base = float(meta["leverage"])
        grids_base = int(meta["grids"])
        band_base = float(meta["band_width_pct"])
        stop_base = float(meta["stop_loss_ratio_pct"])
        base_flag = bool(meta["use_base_position"])

        lev_delta = int(max(1, optimization.refine_leverage_delta))
        grid_delta = int(max(1, optimization.refine_grids_delta))
        band_delta = float(max(0.0, optimization.refine_band_delta_pct))
        stop_delta = float(max(0.0, optimization.refine_stop_delta_pct))

        leverage_values = sorted(
            {
                float(max(leverage_min, min(leverage_max, lev_base - lev_delta))),
                float(max(leverage_min, min(leverage_max, lev_base))),
                float(max(leverage_min, min(leverage_max, lev_base + lev_delta))),
            }
        )
        grid_values = sorted(
            {
                int(max(grids_min, min(grids_max, grids_base - grid_delta))),
                int(max(grids_min, min(grids_max, grids_base))),
                int(max(grids_min, min(grids_max, grids_base + grid_delta))),
            }
        )
        band_values = sorted(
            {
                float(max(band_min, min(band_max, band_base - band_delta))),
                float(max(band_min, min(band_max, band_base))),
                float(max(band_min, min(band_max, band_base + band_delta))),
            }
        )
        stop_values = sorted(
            {
                float(max(stop_min, min(stop_max, stop_base - stop_delta))),
                float(max(stop_min, min(stop_max, stop_base))),
                float(max(stop_min, min(stop_max, stop_base + stop_delta))),
            }
        )

        for leverage, grids, band_pct, stop_pct in product(leverage_values, grid_values, band_values, stop_values):
            combo = _build_single_combo(
                row_id=next_row_id,
                base_strategy=base_strategy,
                reference_price=reference_price,
                initial_price=initial_price,
                leverage=leverage,
                grids=grids,
                band_pct_raw=band_pct,
                stop_ratio_raw=stop_pct,
                use_base_position=base_flag,
                node_cache=node_cache,
            )
            if combo is None:
                continue

            signature = _combo_signature(combo)
            if signature in existing_signatures:
                continue

            existing_signatures.add(signature)
            refine_combos.append(combo)
            next_row_id += 1

    return refine_combos


def _safe_score(value: Optional[float], default: float = float("-inf")) -> float:
    if value is None:
        return default
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(numeric):
        return default
    return numeric


def _primary_score(row: OptimizationResultRow) -> float:
    return _safe_score(row.robust_score, _safe_score(row.score))


def _compute_robust_score(
    train_score: float,
    validation_score: Optional[float],
    validation_weight: float,
    gap_penalty: float,
) -> Tuple[float, Optional[float]]:
    train_value = _safe_score(train_score)
    if validation_score is None:
        return train_value, None

    validation_value = _safe_score(validation_score)
    if validation_value == float("-inf"):
        return train_value, None

    weight = min(max(float(validation_weight), 0.0), 1.0)
    blended = (weight * validation_value) + ((1.0 - weight) * train_value)
    overfit_penalty = abs(train_value - validation_value)
    robust = blended - (overfit_penalty * float(gap_penalty))
    return robust, overfit_penalty


def _apply_constraints(row: OptimizationResultRow, optimization: OptimizationConfig) -> None:
    violations: List[str] = []

    if row.total_closed_trades < optimization.min_closed_trades:
        violations.append(f"train_trades<{optimization.min_closed_trades}")
    if (
        row.validation_total_closed_trades is not None
        and row.validation_total_closed_trades < optimization.min_closed_trades
    ):
        violations.append(f"validation_trades<{optimization.min_closed_trades}")

    if (
        optimization.max_drawdown_pct_limit is not None
        and row.max_drawdown_pct > optimization.max_drawdown_pct_limit
    ):
        violations.append(f"train_drawdown>{optimization.max_drawdown_pct_limit}")
    if (
        optimization.max_drawdown_pct_limit is not None
        and row.validation_max_drawdown_pct is not None
        and row.validation_max_drawdown_pct > optimization.max_drawdown_pct_limit
    ):
        violations.append(f"validation_drawdown>{optimization.max_drawdown_pct_limit}")

    if optimization.require_positive_return and row.total_return_usdt <= 0:
        violations.append("train_return<=0")
    if (
        optimization.require_positive_return
        and row.validation_total_return_usdt is not None
        and row.validation_total_return_usdt <= 0
    ):
        violations.append("validation_return<=0")

    row.constraint_violations = violations
    row.passes_constraints = len(violations) == 0


def _score_sort_key(row: OptimizationResultRow, sort_by: str) -> float:
    value = getattr(row, sort_by, None)
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    return _safe_score(value)


def _paginate_rows(rows: List[OptimizationResultRow], page: int, page_size: int) -> List[OptimizationResultRow]:
    start = (page - 1) * page_size
    end = start + page_size
    return rows[start:end]


def _build_heatmap(rows: List[OptimizationResultRow]) -> List[HeatmapCell]:
    matrix: Dict[Tuple[float, int], List[OptimizationResultRow]] = {}
    for row in rows:
        key = (row.leverage, row.grids)
        matrix.setdefault(key, []).append(row)

    cells: List[HeatmapCell] = []
    for (leverage, grids), grouped_rows in matrix.items():
        candidates = [item for item in grouped_rows if item.passes_constraints] or grouped_rows
        scores: List[float] = []
        for item in candidates:
            score = _primary_score(item)
            if math.isfinite(score):
                scores.append(score)
        avg_score = (sum(scores) / len(scores)) if scores else float("-inf")
        best_row = max(candidates, key=_primary_score)
        cells.append(
            HeatmapCell(
                leverage=leverage,
                grids=grids,
                value=avg_score,
                use_base_position=best_row.use_base_position,
                base_grid_count=best_row.base_grid_count,
                initial_position_size=best_row.initial_position_size,
                anchor_price=best_row.anchor_price,
                lower_price=best_row.lower_price,
                upper_price=best_row.upper_price,
                stop_price=best_row.stop_price,
            )
        )
    return sorted(cells, key=lambda cell: (cell.leverage, cell.grids))


def _export_rows_csv(rows: List[OptimizationResultRow]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "row_id",
            "leverage",
            "grids",
            "use_base_position",
            "base_grid_count",
            "initial_position_size",
            "anchor_price",
            "lower_price",
            "upper_price",
            "stop_price",
            "band_width_pct",
            "range_lower",
            "range_upper",
            "stop_loss",
            "stop_loss_ratio_pct",
            "total_return_usdt",
            "max_drawdown_pct",
            "sharpe_ratio",
            "win_rate",
            "return_drawdown_ratio",
            "score",
            "validation_total_return_usdt",
            "validation_max_drawdown_pct",
            "validation_sharpe_ratio",
            "validation_win_rate",
            "validation_return_drawdown_ratio",
            "validation_score",
            "validation_total_closed_trades",
            "robust_score",
            "overfit_penalty",
            "passes_constraints",
            "constraint_violations",
            "total_closed_trades",
        ]
    )

    for row in rows:
        writer.writerow(
            [
                row.row_id,
                row.leverage,
                row.grids,
                row.use_base_position,
                row.base_grid_count,
                row.initial_position_size,
                row.anchor_price,
                row.lower_price,
                row.upper_price,
                row.stop_price,
                row.band_width_pct,
                row.range_lower,
                row.range_upper,
                row.stop_loss,
                row.stop_loss_ratio_pct,
                row.total_return_usdt,
                row.max_drawdown_pct,
                row.sharpe_ratio,
                row.win_rate,
                row.return_drawdown_ratio,
                row.score,
                row.validation_total_return_usdt,
                row.validation_max_drawdown_pct,
                row.validation_sharpe_ratio,
                row.validation_win_rate,
                row.validation_return_drawdown_ratio,
                row.validation_score,
                row.validation_total_closed_trades,
                row.robust_score,
                row.overfit_penalty,
                row.passes_constraints,
                ";".join(row.constraint_violations),
                row.total_closed_trades,
            ]
        )

    return output.getvalue()


def _update_job_meta(job_id: str, **kwargs: object) -> None:
    with _JOB_LOCK:
        record = _JOBS[job_id]
        for key, value in kwargs.items():
            setattr(record.meta, key, value)


def _run_job(job_id: str, payload: OptimizationRequest) -> None:
    try:
        started = datetime.now(timezone.utc)
        _update_job_meta(job_id, status=OptimizationJobStatus.RUNNING, started_at=started, message="Loading candles")

        candles = load_candles(payload.data)
        if len(candles) < 4:
            raise ValueError("insufficient candle data for optimization")

        train_candles = candles
        validation_candles: List[Candle] = []

        if payload.optimization.walk_forward_enabled:
            train_candles, validation_candles = _split_walk_forward(candles, payload.optimization.train_ratio)

        optimization = payload.optimization
        reference_price = _resolve_anchor_price(candles, payload.optimization)
        initial_price = train_candles[0].close
        progress_lock = threading.Lock()
        completed_steps = 0
        total_steps = 1

        def set_total_steps(new_total: int) -> None:
            nonlocal total_steps, completed_steps
            with progress_lock:
                total_steps = max(1, int(new_total))
                completed_steps = min(completed_steps, total_steps)
                progress = (completed_steps / total_steps) * 100.0
            _update_job_meta(job_id, total_steps=total_steps, completed_steps=completed_steps, progress=progress)

        def advance(step_done: int, step_total: int, stage_offset: int) -> None:
            nonlocal completed_steps
            with progress_lock:
                completed_steps = min(stage_offset + step_done, total_steps)
                progress = (completed_steps / total_steps) * 100.0 if total_steps else 100.0
            _update_job_meta(job_id, completed_steps=completed_steps, progress=progress)

        generated_combinations = 0
        sampled_combinations = 0
        row_lookup: Dict[int, OptimizationResultRow] = {}
        combo_by_id: Dict[int, dict] = {}
        best_score_progression: List[OptimizationProgressPoint] = []
        convergence_curve_data: List[OptimizationProgressPoint] = []
        trials_completed = 0
        trials_pruned = 0

        if optimization.optimization_mode == OptimizationMode.GRID:
            combos = _build_combinations(payload.base_strategy, optimization, reference_price, initial_price)
            if not combos:
                raise ValueError("no valid parameter combinations generated")

            generated_combinations = len(combos)
            sampled_combinations = generated_combinations
            if generated_combinations > optimization.max_combinations:
                if optimization.auto_limit_combinations:
                    combos = _limit_combinations(combos, optimization.max_combinations)
                    sampled_combinations = len(combos)
                else:
                    raise ValueError(
                        f"combination count {generated_combinations} exceeds max_combinations={optimization.max_combinations}"
                    )

            total_steps = len(combos) + (len(combos) if validation_candles else 0)
            eval_tasks = [{"row_id": combo["row_id"], "strategy": combo["strategy"]} for combo in combos]

            running_message = "Running grid optimization"
            if sampled_combinations < generated_combinations:
                running_message = (
                    f"Running grid optimization (sampled {sampled_combinations}/{generated_combinations} combinations)"
                )
            _update_job_meta(
                job_id,
                total_combinations=len(combos),
                total_steps=total_steps,
                completed_steps=0,
                progress=0.0,
                message=running_message,
                trials_completed=0,
                trials_pruned=0,
                pruning_ratio=0.0,
            )

            train_evals = run_combinations_parallel(
                candles=train_candles,
                tasks=eval_tasks,
                interval_value=payload.data.interval.value,
                target=optimization.target,
                custom_score_expr=optimization.custom_score_expr,
                max_workers=optimization.max_workers,
                batch_size=optimization.batch_size,
                chunk_size=optimization.chunk_size,
                progress_hook=lambda done, total: advance(done, total, 0),
            )

            combo_by_id = {int(combo["row_id"]): combo for combo in combos}
            running_best = float("-inf")
            for idx, eval_row in enumerate(train_evals, start=1):
                combo = combo_by_id[int(eval_row["row_id"])]
                row = _build_row_from_eval(combo, eval_row)
                row_lookup[row.row_id] = row

                score = _safe_score(eval_row.get("score"))
                convergence_curve_data.append(OptimizationProgressPoint(step=idx, value=score))
                if score > running_best:
                    running_best = score
                best_score_progression.append(OptimizationProgressPoint(step=idx, value=running_best))

            trials_completed = len(combos)
            trials_pruned = 0
        elif optimization.optimization_mode in (OptimizationMode.BAYESIAN, OptimizationMode.RANDOM_PRUNED):
            parameter_space = _resolve_parameter_space(payload.base_strategy, optimization, reference_price)
            generated_combinations = _total_space_combinations(parameter_space)
            if generated_combinations <= 0:
                raise ValueError("no valid parameter space for trial-based optimization")

            trial_budget = max(1, int(optimization.max_trials))
            sampled_combinations = trial_budget

            total_steps = max(1, trial_budget)
            if optimization.optimization_mode == OptimizationMode.BAYESIAN:
                running_message = (
                    f"Running bayesian optimization (space={generated_combinations}, trials={sampled_combinations})"
                )
            else:
                running_message = (
                    f"Running random-pruned optimization (space={generated_combinations}, trials={sampled_combinations})"
                )
            _update_job_meta(
                job_id,
                total_combinations=trial_budget,
                total_steps=total_steps,
                completed_steps=0,
                progress=0.0,
                message=running_message,
                trials_completed=0,
                trials_pruned=0,
                pruning_ratio=0.0,
            )

            interval_value = payload.data.interval.value
            target = optimization.target
            custom_score_expr = optimization.custom_score_expr
            requires_sharpe_each_checkpoint = target in (OptimizationTarget.SHARPE, OptimizationTarget.CUSTOM)
            fallback_band_pct = _derive_band_width_pct(
                payload.base_strategy.lower,
                payload.base_strategy.upper,
                reference_price,
            )
            fallback_stop_ratio_pct = _derive_stop_loss_ratio_pct(payload.base_strategy)
            base_use_position = bool(payload.base_strategy.use_base_position)
            best_state_lock = threading.Lock()
            best_score_seen: Optional[float] = None
            best_drawdown_seen: Optional[float] = None

            checkpoints = build_pruning_checkpoints(
                total_candles=len(train_candles),
                pruning_steps=optimization.pruning_steps if optimization.enable_early_pruning else 1,
            )
            checkpoint_batches = [(checkpoint, train_candles[:checkpoint]) for checkpoint in checkpoints]
            total_train_candles = len(train_candles)

            def objective_builder(trial: Any) -> BayesianTrialOutcome:
                nonlocal best_score_seen, best_drawdown_seen
                leverage = _suggest_from_sweep(
                    trial,
                    name="leverage",
                    sweep=optimization.leverage,
                    fallback=payload.base_strategy.leverage,
                    integer_mode=False,
                )
                grids = int(
                    round(
                        _suggest_from_sweep(
                            trial,
                            name="grids",
                            sweep=optimization.grids,
                            fallback=float(payload.base_strategy.grids),
                            integer_mode=True,
                        )
                    )
                )
                band_pct_raw = _suggest_from_sweep(
                    trial,
                    name="band_width_pct",
                    sweep=optimization.band_width_pct,
                    fallback=fallback_band_pct,
                    integer_mode=False,
                )
                stop_ratio_raw = _suggest_from_sweep(
                    trial,
                    name="stop_loss_ratio_pct",
                    sweep=optimization.stop_loss_ratio_pct,
                    fallback=fallback_stop_ratio_pct,
                    integer_mode=False,
                )
                if optimization.optimize_base_position:
                    use_base_position = bool(trial.suggest_categorical("use_base_position", [False, True]))
                else:
                    use_base_position = base_use_position

                row_id = int(getattr(trial, "number", 0)) + 1
                combo = _build_single_combo(
                    row_id=row_id,
                    base_strategy=payload.base_strategy,
                    reference_price=reference_price,
                    initial_price=initial_price,
                    leverage=float(leverage),
                    grids=int(grids),
                    band_pct_raw=float(band_pct_raw),
                    stop_ratio_raw=float(stop_ratio_raw),
                    use_base_position=use_base_position,
                    node_cache={},
                )
                if combo is None:
                    raise TrialPruneSignal("invalid parameter combination")

                strategy = combo.get("strategy_obj")
                if not isinstance(strategy, StrategyConfig):
                    strategy = StrategyConfig.model_validate(combo["strategy"])
                theoretical_profit = estimate_theoretical_grid_profit(strategy=strategy, reference_price=initial_price)
                final_eval: Optional[dict] = None

                last_idx = len(checkpoint_batches) - 1
                for checkpoint_idx, (checkpoint, step_candles) in enumerate(checkpoint_batches):
                    eval_payload = _evaluate_strategy_compact(
                        candles=step_candles,
                        strategy=strategy,
                        interval_value=interval_value,
                        target=target,
                        custom_score_expr=custom_score_expr,
                        skip_sharpe=(checkpoint_idx < last_idx and not requires_sharpe_each_checkpoint),
                    )
                    eval_payload["row_id"] = row_id
                    if not eval_payload.get("ok"):
                        raise TrialPruneSignal("evaluation failed")

                    summary = eval_payload["summary"]
                    current_score = float(eval_payload["score"])
                    current_return = float(summary["total_return_usdt"])
                    current_drawdown = float(summary["max_drawdown_pct"])
                    equity_values_count = int(eval_payload.get("equity_values_count", checkpoint))

                    if optimization.enable_early_pruning:
                        if infer_liquidation_from_compact_run(
                            equity_values_count=equity_values_count,
                            evaluated_candles_count=checkpoint,
                            reopen_after_stop=strategy.reopen_after_stop,
                        ):
                            raise TrialPruneSignal("liquidation pruned")

                        best_drawdown_snapshot = best_drawdown_seen
                        best_score_snapshot = best_score_seen

                        if should_prune_by_drawdown(
                            current_drawdown_pct=current_drawdown,
                            best_drawdown_pct=best_drawdown_snapshot,
                            drawdown_prune_multiplier=optimization.drawdown_prune_multiplier,
                        ):
                            raise TrialPruneSignal("drawdown pruned")

                        if optimization.enable_profit_pruning:
                            remaining_ratio = max((total_train_candles - checkpoint) / max(total_train_candles, 1), 0.0)
                            score_upper_bound = score_upper_bound_with_remaining(
                                target=target,
                                current_score=current_score,
                                current_total_return_usdt=current_return,
                                current_drawdown_pct=current_drawdown,
                                best_score=best_score_snapshot,
                                max_remaining_profit=theoretical_profit * remaining_ratio,
                            )
                            if should_prune_by_profit_ceiling(score_upper_bound, best_score_snapshot):
                                raise TrialPruneSignal("profit ceiling pruned")

                    trial.report(current_score, step=int(checkpoint))
                    if checkpoint < total_train_candles and trial.should_prune():
                        raise TrialPruneSignal("optuna pruned")

                    final_eval = eval_payload

                if final_eval is None:
                    raise TrialPruneSignal("empty trial result")

                final_score = _safe_score(final_eval.get("score"))
                final_drawdown = float(final_eval["summary"]["max_drawdown_pct"])
                with best_state_lock:
                    if best_score_seen is None or final_score > best_score_seen:
                        best_score_seen = final_score
                    if best_drawdown_seen is None or final_drawdown < best_drawdown_seen:
                        best_drawdown_seen = final_drawdown

                return BayesianTrialOutcome(score=final_score, combo=combo, eval_payload=final_eval)

            if optimization.optimization_mode == OptimizationMode.BAYESIAN:
                trial_run = run_bayesian_search(
                    total_trials=trial_budget,
                    max_workers=optimization.max_workers,
                    warmup_ratio=optimization.warmup_ratio,
                    random_seed=optimization.random_seed,
                    resume_study=optimization.resume_study,
                    resume_study_key=optimization.resume_study_key,
                    objective_builder=objective_builder,
                    progress_hook=lambda done, total: advance(done, total, 0),
                )
            else:
                trial_run = run_random_pruned_search(
                    total_trials=trial_budget,
                    max_workers=optimization.max_workers,
                    random_seed=optimization.random_seed,
                    resume_study=optimization.resume_study,
                    resume_study_key=optimization.resume_study_key,
                    objective_builder=objective_builder,
                    progress_hook=lambda done, total: advance(done, total, 0),
                )

            successful_trials = [item for item in trial_run.successful_trials if item.combo and item.eval_payload]
            if not successful_trials:
                raise ValueError("trial-based optimization produced no valid completed trials")

            best_score_progression = list(trial_run.best_score_progression)
            convergence_curve_data = list(trial_run.convergence_curve_data)
            trials_completed = int(trial_run.trials_completed)
            trials_pruned = int(trial_run.trials_pruned)

            combo_by_id = {int(item.combo["row_id"]): item.combo for item in successful_trials if item.combo}
            for item in successful_trials:
                if item.combo is None or item.eval_payload is None:
                    continue
                row = _build_row_from_eval(item.combo, item.eval_payload)
                row_lookup[row.row_id] = row

            if optimization.enable_topk_refine and successful_trials:
                ranked_trials = sorted(successful_trials, key=lambda item: _safe_score(item.score), reverse=True)
                top_trials = ranked_trials[: min(optimization.topk_refine_k, len(ranked_trials))]
                existing_signatures = {_combo_signature(item.combo) for item in successful_trials if item.combo}
                next_row = (max(combo_by_id.keys()) + 1) if combo_by_id else 1
                refine_combos = _generate_refine_combos(
                    top_trials=top_trials,
                    base_strategy=payload.base_strategy,
                    optimization=optimization,
                    reference_price=reference_price,
                    initial_price=initial_price,
                    row_id_start=next_row,
                    existing_signatures=existing_signatures,
                    parameter_space=parameter_space,
                )
                if refine_combos:
                    refine_start = completed_steps
                    set_total_steps(total_steps + len(refine_combos))

                    refine_combo_by_id = {int(combo["row_id"]): combo for combo in refine_combos}
                    refine_tasks = [{"row_id": combo["row_id"], "strategy": combo["strategy"]} for combo in refine_combos]
                    refine_evals = run_combinations_parallel(
                        candles=train_candles,
                        tasks=refine_tasks,
                        interval_value=payload.data.interval.value,
                        target=optimization.target,
                        custom_score_expr=optimization.custom_score_expr,
                        max_workers=optimization.max_workers,
                        batch_size=optimization.batch_size,
                        chunk_size=optimization.chunk_size,
                        progress_hook=lambda done, total: advance(done, total, refine_start),
                    )

                    running_best = best_score_progression[-1].value if best_score_progression else float("-inf")
                    progression_base = len(convergence_curve_data)
                    for idx, eval_row in enumerate(refine_evals, start=1):
                        combo = refine_combo_by_id.get(int(eval_row["row_id"]))
                        if combo is None:
                            continue
                        combo_by_id[int(combo["row_id"])] = combo
                        row = _build_row_from_eval(combo, eval_row)
                        row_lookup[row.row_id] = row

                        score = _safe_score(eval_row.get("score"))
                        convergence_curve_data.append(
                            OptimizationProgressPoint(step=progression_base + idx, value=score)
                        )
                        if score > running_best:
                            running_best = score
                        best_score_progression.append(
                            OptimizationProgressPoint(step=progression_base + idx, value=running_best)
                        )

                    trials_completed += len(refine_evals)
                    sampled_combinations = trial_budget + len(refine_combos)
        else:
            raise ValueError(f"unsupported optimization mode: {optimization.optimization_mode}")

        if not row_lookup:
            raise ValueError("optimization produced no valid evaluated rows")

        if validation_candles:
            validation_tasks = [
                {"row_id": combo["row_id"], "strategy": combo["strategy"]}
                for _, combo in sorted(combo_by_id.items(), key=lambda item: item[0])
            ]
            validation_offset = completed_steps
            set_total_steps(completed_steps + len(validation_tasks))

            validation_evals = run_combinations_parallel(
                candles=validation_candles,
                tasks=validation_tasks,
                interval_value=payload.data.interval.value,
                target=optimization.target,
                custom_score_expr=optimization.custom_score_expr,
                max_workers=optimization.max_workers,
                batch_size=optimization.batch_size,
                chunk_size=optimization.chunk_size,
                progress_hook=lambda done, total: advance(done, total, validation_offset),
            )

            for eval_row in validation_evals:
                row_id = int(eval_row["row_id"])
                row = row_lookup.get(row_id)
                if row is None:
                    continue
                summary = eval_row["summary"] if eval_row.get("ok") else None
                if summary:
                    row.validation_total_return_usdt = float(summary["total_return_usdt"])
                    row.validation_max_drawdown_pct = float(summary["max_drawdown_pct"])
                    row.validation_sharpe_ratio = float(eval_row["sharpe_ratio"])
                    row.validation_win_rate = float(summary["win_rate"])
                    row.validation_return_drawdown_ratio = float(eval_row["return_drawdown_ratio"])
                    row.validation_score = float(eval_row["score"])
                    row.validation_total_closed_trades = int(summary["total_closed_trades"])

        rows = list(row_lookup.values())
        for row in rows:
            robust_score, overfit_penalty = _compute_robust_score(
                train_score=row.score,
                validation_score=row.validation_score,
                validation_weight=optimization.robust_validation_weight,
                gap_penalty=optimization.robust_gap_penalty,
            )
            row.robust_score = robust_score
            row.overfit_penalty = overfit_penalty
            _apply_constraints(row, optimization)

        passed_rows = [row for row in rows if row.passes_constraints]
        passed_ranked_rows = sorted(passed_rows, key=lambda row: _primary_score(row), reverse=True)
        all_ranked_rows = sorted(rows, key=lambda row: (row.passes_constraints, _primary_score(row)), reverse=True)
        # Keep strict pass-only output when available; fallback to all rows for diagnostics when none pass.
        ranked_rows = passed_ranked_rows if passed_ranked_rows else all_ranked_rows
        best_row = passed_ranked_rows[0] if passed_ranked_rows else None
        best_validation_row = None
        if passed_ranked_rows and any(row.validation_score is not None for row in passed_ranked_rows):
            best_validation_row = max(
                passed_ranked_rows,
                key=lambda row: row.validation_score if row.validation_score is not None else float("-inf"),
            )

        best_equity_curve: List[CurvePoint] = []
        if best_row:
            best_strategy = payload.base_strategy.model_copy(
                update={
                    "leverage": best_row.leverage,
                    "grids": best_row.grids,
                    "lower": best_row.lower_price,
                    "upper": best_row.upper_price,
                    "stop_loss": best_row.stop_price,
                    "use_base_position": best_row.use_base_position,
                }
            )
            full_result: BacktestResult = run_backtest(candles=candles, strategy=best_strategy)
            best_equity_curve = full_result.equity_curve

        tested_total = max(trials_completed + trials_pruned, 1)
        pruning_ratio = trials_pruned / tested_total

        with _JOB_LOCK:
            record = _JOBS[job_id]
            record.rows = ranked_rows
            record.best_row = best_row
            record.best_validation_row = best_validation_row
            record.best_equity_curve = best_equity_curve
            record.best_score_progression = best_score_progression
            record.convergence_curve_data = convergence_curve_data
            record.train_window = _window_info(train_candles)
            record.validation_window = _window_info(validation_candles) if validation_candles else None
            record.meta.status = OptimizationJobStatus.COMPLETED
            record.meta.finished_at = datetime.now(timezone.utc)
            record.meta.completed_steps = total_steps
            record.meta.progress = 100.0
            record.meta.total_combinations = sampled_combinations
            record.meta.total_steps = total_steps
            record.meta.trials_completed = trials_completed
            record.meta.trials_pruned = trials_pruned
            record.meta.pruning_ratio = pruning_ratio
            mode_label = (
                "trials"
                if optimization.optimization_mode in (OptimizationMode.BAYESIAN, OptimizationMode.RANDOM_PRUNED)
                else "combinations"
            )
            passed_count = len(passed_ranked_rows)
            shown_count = len(ranked_rows)
            if sampled_combinations < generated_combinations:
                base_message = (
                    f"Optimization completed (tested {sampled_combinations}/{generated_combinations} {mode_label}, passed={passed_count})"
                )
            else:
                base_message = f"Optimization completed (passed={passed_count})"

            if passed_count == 0 and shown_count > 0:
                record.meta.message = f"{base_message}; no rows passed constraints, showing diagnostic rows"
            else:
                record.meta.message = base_message
    except BayesianDependencyError as exc:
        _update_job_meta(
            job_id,
            status=OptimizationJobStatus.FAILED,
            finished_at=datetime.now(timezone.utc),
            error=str(exc),
            message="Optimization failed",
        )
    except Exception as exc:
        _update_job_meta(
            job_id,
            status=OptimizationJobStatus.FAILED,
            finished_at=datetime.now(timezone.utc),
            error=str(exc),
            message="Optimization failed",
        )


def start_optimization_job(payload: OptimizationRequest) -> OptimizationStartResponse:
    job_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc)

    meta = OptimizationJobMeta(
        job_id=job_id,
        status=OptimizationJobStatus.PENDING,
        created_at=created_at,
        total_combinations=0,
    )

    with _JOB_LOCK:
        _JOBS[job_id] = _JobRecord(meta=meta, target=payload.optimization.target)

    thread = threading.Thread(target=_run_job, args=(job_id, payload), daemon=True)
    thread.start()

    return OptimizationStartResponse(job_id=job_id, status=OptimizationJobStatus.PENDING, total_combinations=0)


def get_optimization_status(
    job_id: str,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: SortOrder,
) -> OptimizationStatusResponse:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            raise KeyError(f"optimization job not found: {job_id}")

        rows = list(record.rows)
        meta = record.meta.model_copy(deep=True)
        best_row = record.best_row
        best_validation_row = record.best_validation_row
        best_equity_curve = list(record.best_equity_curve)
        best_score_progression = list(record.best_score_progression)
        convergence_curve_data = list(record.convergence_curve_data)
        train_window = record.train_window
        validation_window = record.validation_window
        target = record.target

    sort_field = sort_by if sort_by in OptimizationResultRow.model_fields else "robust_score"
    reverse = sort_order == SortOrder.DESC
    rows.sort(key=lambda row: _score_sort_key(row, sort_field), reverse=reverse)

    total_results = len(rows)
    paged = _paginate_rows(rows, page=page, page_size=page_size)

    return OptimizationStatusResponse(
        job=meta,
        target=target,
        sort_by=sort_field,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
        total_results=total_results,
        rows=paged,
        best_row=best_row,
        best_validation_row=best_validation_row,
        best_equity_curve=best_equity_curve,
        best_score_progression=best_score_progression,
        convergence_curve_data=convergence_curve_data,
        heatmap=_build_heatmap(rows),
        train_window=train_window,
        validation_window=validation_window,
    )


def export_optimization_csv(job_id: str, sort_by: str, sort_order: SortOrder) -> str:
    with _JOB_LOCK:
        record = _JOBS.get(job_id)
        if record is None:
            raise KeyError(f"optimization job not found: {job_id}")
        if record.meta.status != OptimizationJobStatus.COMPLETED:
            raise ValueError("optimization job is not completed")
        rows = list(record.rows)

    sort_field = sort_by if sort_by in OptimizationResultRow.model_fields else "robust_score"
    reverse = sort_order == SortOrder.DESC
    rows.sort(key=lambda row: _score_sort_key(row, sort_field), reverse=reverse)

    return _export_rows_csv(rows)
