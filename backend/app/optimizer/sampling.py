from __future__ import annotations

import math
import random
from dataclasses import dataclass
from itertools import product
from typing import Any, Dict, List, Optional, Tuple

from app.core.optimization_schemas import AnchorMode, OptimizationConfig, SweepRange
from app.core.schemas import Candle, StrategyConfig
from app.optimizer.bayesian_optimizer import BayesianTrialOutcome
from app.services.grid_logic import build_grid_nodes, derive_base_position_grid_indices as shared_derive_base_position_grid_indices
from app.services.risk_limit import (
    estimate_initial_avg_entry_and_liquidation_price,
    estimate_max_possible_loss_at_stop,
)


def normalize_pct(value: float) -> float:
    # Optimization ranges are percentage inputs (e.g. 5 => 5%).
    return value / 100.0


def round_price(value: float) -> float:
    return float(f"{float(value):.2f}")


def resolve_anchor_price(candles: List[Candle], optimization: OptimizationConfig) -> float:
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

    return round_price(anchor_price)


def expand_sweep(sweep: SweepRange, integer_mode: bool = False) -> List[float]:
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


def derive_band_width_pct(lower: float, upper: float, center_price: float) -> float:
    if center_price <= 0:
        return 0.0
    return ((upper - lower) / (2 * center_price)) * 100.0


def derive_stop_loss_ratio_pct(strategy: StrategyConfig) -> float:
    if strategy.side.value == "short" and strategy.upper > 0:
        return ((strategy.stop_loss / strategy.upper) - 1.0) * 100.0
    if strategy.side.value == "long" and strategy.lower > 0:
        return (1.0 - (strategy.stop_loss / strategy.lower)) * 100.0
    return 0.0


def grid_nodes_with_cache(
    lower: float,
    upper: float,
    grids: int,
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]],
) -> Tuple[List[float], float]:
    cache_key = (float(lower), float(upper), int(grids))
    cached = node_cache.get(cache_key)
    if cached is not None:
        return cached

    nodes, eps = build_grid_nodes(lower, upper, grids)
    node_cache[cache_key] = (nodes, eps)
    return nodes, eps


def derive_base_position_grid_indices(
    strategy: StrategyConfig,
    *,
    current_price: float,
    nodes: Optional[List[float]] = None,
    eps: Optional[float] = None,
) -> List[int]:
    return shared_derive_base_position_grid_indices(
        strategy,
        current_price=current_price,
        nodes=nodes,
        eps=eps,
    )


def derive_base_position_info(
    strategy: StrategyConfig,
    *,
    current_price: float,
    nodes: Optional[List[float]] = None,
    eps: Optional[float] = None,
) -> Tuple[int, float]:
    grid_indices = derive_base_position_grid_indices(strategy, current_price=current_price, nodes=nodes, eps=eps)
    if not grid_indices:
        return 0, 0.0

    base_grid_count = len(grid_indices)
    total_nominal = strategy.margin * strategy.leverage
    position_per_grid = total_nominal / strategy.grids
    initial_position_size = position_per_grid * base_grid_count
    return int(base_grid_count), float(initial_position_size)


def estimate_initial_avg_entry_and_liquidation(
    strategy: StrategyConfig,
    *,
    current_price: float,
    grid_lines: Optional[List[float]] = None,
    eps: Optional[float] = None,
    base_grid_indices: Optional[List[int]] = None,
) -> Tuple[Optional[float], Optional[float]]:
    # Keep optimizer pre-check aligned with backtest risk engine.
    # We intentionally ignore optional precomputed nodes here to avoid
    # drifting from the single source of truth in services/risk_limit.py.
    _ = grid_lines, eps, base_grid_indices
    return estimate_initial_avg_entry_and_liquidation_price(
        strategy,
        initial_price=current_price,
    )


@dataclass
class ParameterSpace:
    leverage_values: List[float]
    grid_values: List[int]
    band_values: List[float]
    stop_ratio_values: List[float]
    base_position_values: List[bool]


def resolve_parameter_space(
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
) -> ParameterSpace:
    leverage_values = (
        expand_sweep(optimization.leverage, integer_mode=False)
        if optimization.leverage.enabled
        else [base_strategy.leverage]
    )
    grid_values = expand_sweep(optimization.grids, integer_mode=True) if optimization.grids.enabled else [base_strategy.grids]
    band_values = (
        expand_sweep(optimization.band_width_pct, integer_mode=False)
        if optimization.band_width_pct.enabled
        else [derive_band_width_pct(base_strategy.lower, base_strategy.upper, reference_price)]
    )
    stop_ratio_values = (
        expand_sweep(optimization.stop_loss_ratio_pct, integer_mode=False)
        if optimization.stop_loss_ratio_pct.enabled
        else [derive_stop_loss_ratio_pct(base_strategy)]
    )
    base_position_values = [False, True] if optimization.optimize_base_position else [base_strategy.use_base_position]

    return ParameterSpace(
        leverage_values=[float(v) for v in leverage_values],
        grid_values=[int(v) for v in grid_values],
        band_values=[float(v) for v in band_values],
        stop_ratio_values=[float(v) for v in stop_ratio_values],
        base_position_values=[bool(v) for v in base_position_values],
    )


def total_space_combinations(space: ParameterSpace) -> int:
    return (
        len(space.leverage_values)
        * len(space.grid_values)
        * len(space.band_values)
        * len(space.stop_ratio_values)
        * len(space.base_position_values)
    )


def is_effectively_integer(value: float) -> bool:
    return abs(value - round(value)) < 1e-9


def suggest_from_sweep(
    trial: Any,
    *,
    name: str,
    sweep: SweepRange,
    fallback: float,
    integer_mode: bool = False,
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

    if is_effectively_integer(float(sweep.start)) and is_effectively_integer(float(sweep.end)) and is_effectively_integer(float(sweep.step)):
        start = int(round(sweep.start))
        end = int(round(sweep.end))
        step = max(1, int(round(sweep.step)))
        return float(trial.suggest_int(name, start, end, step=step))

    return float(trial.suggest_float(name, float(sweep.start), float(sweep.end), step=float(sweep.step)))


def build_single_combo(
    *,
    row_id: int,
    base_strategy: StrategyConfig,
    reference_price: float,
    initial_price: float,
    max_loss_initial_price: Optional[float] = None,
    leverage: float,
    grids: int,
    band_pct_raw: float,
    stop_ratio_raw: float,
    use_base_position: bool,
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]],
    max_allowed_loss_usdt: Optional[float] = None,
) -> Optional[dict]:
    band_ratio = normalize_pct(float(band_pct_raw))
    stop_ratio = normalize_pct(float(stop_ratio_raw))

    lower = round_price(reference_price * (1.0 - band_ratio))
    upper = round_price(reference_price * (1.0 + band_ratio))
    if lower <= 0 or upper <= lower:
        return None

    if base_strategy.side.value == "short":
        stop_loss = round_price(upper * (1.0 + stop_ratio))
    else:
        stop_loss = round_price(lower * (1.0 - stop_ratio))
    if stop_loss <= 0:
        return None

    nodes, eps = grid_nodes_with_cache(float(lower), float(upper), int(grids), node_cache)
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
    base_grid_indices = derive_base_position_grid_indices(
        strategy,
        current_price=initial_price,
        nodes=nodes,
        eps=eps,
    )

    _, estimated_liq_price = estimate_initial_avg_entry_and_liquidation(
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

    base_grid_count, initial_position_size = derive_base_position_info(
        strategy,
        current_price=initial_price,
        nodes=nodes,
        eps=eps,
    )
    loss_anchor_price = float(max_loss_initial_price) if max_loss_initial_price is not None else float(initial_price)
    max_possible_loss_usdt = estimate_max_possible_loss_at_stop(strategy, initial_price=loss_anchor_price)
    if max_allowed_loss_usdt is not None and max_possible_loss_usdt > (float(max_allowed_loss_usdt) + 1e-9):
        return None

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
            "anchor_price": round_price(reference_price),
            "lower_price": float(lower),
            "upper_price": float(upper),
            "stop_price": float(stop_loss),
            "band_width_pct": band_ratio * 100.0,
            "range_lower": float(lower),
            "range_upper": float(upper),
            "stop_loss": float(stop_loss),
            "stop_loss_ratio_pct": float(effective_stop_ratio_pct),
            "max_possible_loss_usdt": float(max_possible_loss_usdt),
        },
    }


def build_combinations(
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
    initial_price: float,
    max_loss_initial_price: Optional[float] = None,
) -> List[dict]:
    space = resolve_parameter_space(base_strategy, optimization, reference_price)

    combos: List[dict] = []
    row_id = 1
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}

    for leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position in product(
        space.leverage_values, space.grid_values, space.band_values, space.stop_ratio_values, space.base_position_values
    ):
        combo = build_single_combo(
            row_id=row_id,
            base_strategy=base_strategy,
            reference_price=reference_price,
            initial_price=initial_price,
            max_loss_initial_price=max_loss_initial_price,
            leverage=float(leverage),
            grids=int(grids),
            band_pct_raw=float(band_pct_raw),
            stop_ratio_raw=float(stop_ratio_raw),
            use_base_position=bool(use_base_position),
            node_cache=node_cache,
            max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
        )
        if combo is None:
            continue

        combos.append(combo)
        row_id += 1

    return combos


def _combo_index_to_params(
    space: ParameterSpace,
    flat_index: int,
) -> tuple[float, int, float, float, bool]:
    leverage_n = len(space.leverage_values)
    grid_n = len(space.grid_values)
    band_n = len(space.band_values)
    stop_n = len(space.stop_ratio_values)
    base_n = len(space.base_position_values)
    total = leverage_n * grid_n * band_n * stop_n * base_n
    if total <= 0:
        raise ValueError("invalid parameter space")

    idx = int(flat_index) % total
    base_i = idx % base_n
    idx //= base_n
    stop_i = idx % stop_n
    idx //= stop_n
    band_i = idx % band_n
    idx //= band_n
    grid_i = idx % grid_n
    idx //= grid_n
    leverage_i = idx % leverage_n
    return (
        float(space.leverage_values[leverage_i]),
        int(space.grid_values[grid_i]),
        float(space.band_values[band_i]),
        float(space.stop_ratio_values[stop_i]),
        bool(space.base_position_values[base_i]),
    )


def _evenly_spaced_indices(total: int, count: int) -> list[int]:
    if total <= 0 or count <= 0:
        return []
    if count >= total:
        return list(range(total))
    if count == 1:
        return [0]
    last = total - 1
    ratio = last / (count - 1)
    seen: set[int] = set()
    indices: list[int] = []
    for i in range(count):
        idx = int(round(i * ratio))
        if idx in seen:
            continue
        seen.add(idx)
        indices.append(idx)
    cursor = 0
    while len(indices) < count and cursor < total:
        if cursor not in seen:
            seen.add(cursor)
            indices.append(cursor)
        cursor += 1
    indices.sort()
    return indices[:count]


def build_combinations_limited(
    *,
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
    initial_price: float,
    max_loss_initial_price: Optional[float] = None,
    max_count: int,
    seed: Optional[int] = None,
) -> tuple[list[dict], int]:
    space = resolve_parameter_space(base_strategy, optimization, reference_price)
    total_space = total_space_combinations(space)
    if total_space <= 0 or max_count <= 0:
        return [], total_space

    target = max(1, min(int(max_count), total_space))
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}
    combos: list[dict] = []
    row_id = 1

    # First pass: deterministic even coverage across full cartesian space.
    base_indices = _evenly_spaced_indices(total_space, target)
    seen_indices: set[int] = set()
    for flat_idx in base_indices:
        seen_indices.add(flat_idx)
        leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position = _combo_index_to_params(space, flat_idx)
        combo = build_single_combo(
            row_id=row_id,
            base_strategy=base_strategy,
            reference_price=reference_price,
            initial_price=initial_price,
            max_loss_initial_price=max_loss_initial_price,
            leverage=leverage,
            grids=grids,
            band_pct_raw=band_pct_raw,
            stop_ratio_raw=stop_ratio_raw,
            use_base_position=use_base_position,
            node_cache=node_cache,
            max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
        )
        if combo is None:
            continue
        combos.append(combo)
        row_id += 1

    # Second pass: deterministic random fill for invalidly filtered holes.
    if len(combos) < target and len(seen_indices) < total_space:
        rng = random.Random(seed if seed is not None else 0xC0FFEE)
        attempts = 0
        max_attempts = max(target * 30, 3_000)
        while len(combos) < target and len(seen_indices) < total_space and attempts < max_attempts:
            attempts += 1
            flat_idx = int(rng.randrange(total_space))
            if flat_idx in seen_indices:
                continue
            seen_indices.add(flat_idx)
            leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position = _combo_index_to_params(space, flat_idx)
            combo = build_single_combo(
                row_id=row_id,
                base_strategy=base_strategy,
                reference_price=reference_price,
                initial_price=initial_price,
                max_loss_initial_price=max_loss_initial_price,
                leverage=leverage,
                grids=grids,
                band_pct_raw=band_pct_raw,
                stop_ratio_raw=stop_ratio_raw,
                use_base_position=use_base_position,
                node_cache=node_cache,
                max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
            )
            if combo is None:
                continue
            combos.append(combo)
            row_id += 1

    return combos, total_space


def limit_combinations(combos: List[dict], max_count: int) -> List[dict]:
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


def sample_random_combinations(
    *,
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
    initial_price: float,
    max_loss_initial_price: Optional[float] = None,
    trial_budget: int,
    seed: Optional[int],
) -> Tuple[List[dict], int]:
    space = resolve_parameter_space(base_strategy, optimization, reference_price)
    total_space = total_space_combinations(space)
    if total_space <= 0:
        return [], 0

    target_trials = max(1, min(int(trial_budget), total_space))
    rng = random.Random(seed if seed is not None else 0xC0FFEE)
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}
    sampled: List[dict] = []
    seen_tuples: set[Tuple[float, int, float, float, bool]] = set()
    pruned_invalid = 0

    def draw_tuple() -> Tuple[float, int, float, float, bool]:
        return (
            float(rng.choice(space.leverage_values)),
            int(rng.choice(space.grid_values)),
            float(rng.choice(space.band_values)),
            float(rng.choice(space.stop_ratio_values)),
            bool(rng.choice(space.base_position_values)),
        )

    max_attempts = max(target_trials * 25, 2_000)
    attempts = 0
    while len(sampled) < target_trials and attempts < max_attempts and len(seen_tuples) < total_space:
        attempts += 1
        param_tuple = draw_tuple()
        if param_tuple in seen_tuples:
            continue
        seen_tuples.add(param_tuple)
        leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position = param_tuple
        combo = build_single_combo(
            row_id=len(sampled) + 1,
            base_strategy=base_strategy,
            reference_price=reference_price,
            initial_price=initial_price,
            max_loss_initial_price=max_loss_initial_price,
            leverage=leverage,
            grids=grids,
            band_pct_raw=band_pct_raw,
            stop_ratio_raw=stop_ratio_raw,
            use_base_position=use_base_position,
            node_cache=node_cache,
            max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
        )
        if combo is None:
            pruned_invalid += 1
            continue
        sampled.append(combo)

    # Fallback sweep when random sampling space is saturated by invalid candidates.
    if len(sampled) < target_trials:
        for leverage, grids, band_pct_raw, stop_ratio_raw, use_base_position in product(
            space.leverage_values, space.grid_values, space.band_values, space.stop_ratio_values, space.base_position_values
        ):
            if len(sampled) >= target_trials:
                break
            param_tuple = (
                float(leverage),
                int(grids),
                float(band_pct_raw),
                float(stop_ratio_raw),
                bool(use_base_position),
            )
            if param_tuple in seen_tuples:
                continue
            seen_tuples.add(param_tuple)
            combo = build_single_combo(
                row_id=len(sampled) + 1,
                base_strategy=base_strategy,
                reference_price=reference_price,
                initial_price=initial_price,
                max_loss_initial_price=max_loss_initial_price,
                leverage=float(leverage),
                grids=int(grids),
                band_pct_raw=float(band_pct_raw),
                stop_ratio_raw=float(stop_ratio_raw),
                use_base_position=bool(use_base_position),
                node_cache=node_cache,
                max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
            )
            if combo is None:
                pruned_invalid += 1
                continue
            sampled.append(combo)

    for row_id, combo in enumerate(sampled, start=1):
        combo["row_id"] = row_id

    return sampled, pruned_invalid


def combo_signature(combo: dict) -> Tuple[Any, ...]:
    meta = combo["meta"]
    return (
        float(meta["leverage"]),
        int(meta["grids"]),
        float(meta["lower_price"]),
        float(meta["upper_price"]),
        float(meta["stop_price"]),
        bool(meta["use_base_position"]),
    )


def safe_min(values: List[float], fallback: float) -> float:
    return min(values) if values else fallback


def safe_max(values: List[float], fallback: float) -> float:
    return max(values) if values else fallback


def generate_refine_combos(
    *,
    top_trials: List[BayesianTrialOutcome],
    base_strategy: StrategyConfig,
    optimization: OptimizationConfig,
    reference_price: float,
    initial_price: float,
    max_loss_initial_price: Optional[float] = None,
    row_id_start: int,
    existing_signatures: set[Tuple[Any, ...]],
    parameter_space: ParameterSpace,
) -> List[dict]:
    refine_combos: List[dict] = []
    next_row_id = row_id_start
    node_cache: Dict[Tuple[float, float, int], Tuple[List[float], float]] = {}

    lev_min = safe_min(parameter_space.leverage_values, base_strategy.leverage)
    lev_max = safe_max(parameter_space.leverage_values, base_strategy.leverage)
    grid_min = int(safe_min([float(v) for v in parameter_space.grid_values], float(base_strategy.grids)))
    grid_max = int(safe_max([float(v) for v in parameter_space.grid_values], float(base_strategy.grids)))
    band_min = safe_min(parameter_space.band_values, derive_band_width_pct(base_strategy.lower, base_strategy.upper, reference_price))
    band_max = safe_max(parameter_space.band_values, derive_band_width_pct(base_strategy.lower, base_strategy.upper, reference_price))
    stop_min = safe_min(parameter_space.stop_ratio_values, derive_stop_loss_ratio_pct(base_strategy))
    stop_max = safe_max(parameter_space.stop_ratio_values, derive_stop_loss_ratio_pct(base_strategy))

    for trial in top_trials:
        combo = trial.combo or {}
        strategy = combo.get("strategy", {})
        base_flag = bool(strategy.get("use_base_position", base_strategy.use_base_position))

        lev_delta = int(max(1, optimization.refine_leverage_delta))
        grid_delta = int(max(1, optimization.refine_grids_delta))
        band_delta = float(max(0.0, optimization.refine_band_delta_pct))
        stop_delta = float(max(0.0, optimization.refine_stop_delta_pct))

        lev_base = float(strategy.get("leverage", base_strategy.leverage))
        grid_base = int(strategy.get("grids", base_strategy.grids))
        band_base = float(combo.get("meta", {}).get("band_width_pct", band_min))
        stop_base = float(combo.get("meta", {}).get("stop_loss_ratio_pct", stop_min))

        leverage_values = sorted(
            {
                float(max(lev_min, min(lev_max, lev_base - lev_delta))),
                float(max(lev_min, min(lev_max, lev_base))),
                float(max(lev_min, min(lev_max, lev_base + lev_delta))),
            }
        )
        grid_values = sorted(
            {
                int(max(grid_min, min(grid_max, grid_base - grid_delta))),
                int(max(grid_min, min(grid_max, grid_base))),
                int(max(grid_min, min(grid_max, grid_base + grid_delta))),
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
            combo = build_single_combo(
                row_id=next_row_id,
                base_strategy=base_strategy,
                reference_price=reference_price,
                initial_price=initial_price,
                max_loss_initial_price=max_loss_initial_price,
                leverage=leverage,
                grids=grids,
                band_pct_raw=band_pct,
                stop_ratio_raw=stop_pct,
                use_base_position=base_flag,
                node_cache=node_cache,
                max_allowed_loss_usdt=optimization.max_allowed_loss_usdt,
            )
            if combo is None:
                continue

            signature = combo_signature(combo)
            if signature in existing_signatures:
                continue

            existing_signatures.add(signature)
            refine_combos.append(combo)
            next_row_id += 1

    return refine_combos
