from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.core.schemas import Candle, CurvePoint, DataConfig, DataSource, GridSide, Interval, StrategyConfig, LiveFill, LiveFundingEntry, LiveInferredGrid, LivePosition, LiveRobotOverview, MarketParamsResponse
from app.services.backtest_engine import run_backtest
from app.services.data_loader import DataLoadError, load_candles, load_funding_rates, load_mark_price_candles

LIVE_PNL_CURVE_TARGET_POINTS = 480
LIVE_PNL_CURVE_MAX_POINTS = 480
LIVE_PNL_CURVE_INTERVAL_SECONDS: tuple[tuple[Interval, int], ...] = (
    (Interval.M15, 15 * 60),
    (Interval.M30, 30 * 60),
    (Interval.H1, 60 * 60),
    (Interval.H2, 2 * 60 * 60),
    (Interval.H4, 4 * 60 * 60),
    (Interval.H6, 6 * 60 * 60),
    (Interval.H12, 12 * 60 * 60),
    (Interval.D1, 24 * 60 * 60),
)
LIVE_PNL_CURVE_EPSILON = 1e-9


@dataclass
class LivePnlReplayState:
    signed_qty: float = 0.0
    avg_entry_price: float = 0.0
    realized_pnl: float = 0.0
    fees_paid: float = 0.0
    funding_net: float = 0.0



def normalize_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        seconds = float(value)
        if abs(seconds) > 1_000_000_000_000:
            seconds = seconds / 1000.0
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if raw.isdigit():
            return normalize_datetime(int(raw))
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError as exc:
            raise DataLoadError(f"无法解析时间: {raw}") from exc
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    raise DataLoadError(f"无法解析时间: {value!r}")



def choose_live_pnl_curve_interval(start_at: datetime, end_at: datetime) -> Interval:
    total_seconds = max(1, int((end_at - start_at).total_seconds()))
    target_step = max(60, total_seconds // LIVE_PNL_CURVE_TARGET_POINTS)
    for interval, interval_seconds in LIVE_PNL_CURVE_INTERVAL_SECONDS:
        if interval_seconds >= target_step:
            return interval
    return Interval.D1



def downsample_curve_points(points: list[CurvePoint], max_points: int = LIVE_PNL_CURVE_MAX_POINTS) -> list[CurvePoint]:
    if len(points) <= max_points:
        return points
    if max_points <= 2:
        return [points[0], points[-1]]
    step = (len(points) - 1) / float(max_points - 1)
    sampled = [points[0]]
    for index in range(1, max_points - 1):
        sampled.append(points[round(index * step)])
    sampled.append(points[-1])
    compacted: list[CurvePoint] = []
    for point in sampled:
        if compacted and compacted[-1].timestamp == point.timestamp:
            compacted[-1] = point
        else:
            compacted.append(point)
    return compacted



def append_curve_point(points: list[CurvePoint], timestamp: datetime, value: float) -> None:
    point = CurvePoint(timestamp=normalize_datetime(timestamp), value=float(value))
    if points and points[-1].timestamp == point.timestamp:
        points[-1] = point
        return
    points.append(point)



def apply_live_pnl_fill(state: LivePnlReplayState, fill: LiveFill) -> None:
    side = str(fill.side).lower()
    signed_fill_qty = fill.quantity if side == "buy" else -fill.quantity
    current_qty = state.signed_qty
    next_qty = current_qty + signed_fill_qty
    closing_qty = 0.0
    opening_qty = signed_fill_qty
    if current_qty != 0.0 and signed_fill_qty != 0.0 and math.copysign(1.0, current_qty) != math.copysign(1.0, signed_fill_qty):
        closing_qty = min(abs(current_qty), abs(signed_fill_qty))
        opening_qty = signed_fill_qty + math.copysign(closing_qty, current_qty)
        state.realized_pnl += closing_qty * (fill.price - state.avg_entry_price) * math.copysign(1.0, current_qty)
    elif current_qty != 0.0 and math.copysign(1.0, current_qty) == math.copysign(1.0, signed_fill_qty):
        opening_qty = signed_fill_qty
    if opening_qty != 0.0:
        remaining_qty = current_qty + opening_qty
        if current_qty == 0.0 or math.copysign(1.0, current_qty) != math.copysign(1.0, remaining_qty):
            state.avg_entry_price = fill.price
        else:
            total_abs_qty = abs(current_qty) + abs(opening_qty)
            if total_abs_qty > LIVE_PNL_CURVE_EPSILON:
                state.avg_entry_price = (
                    abs(current_qty) * state.avg_entry_price + abs(opening_qty) * fill.price
                ) / total_abs_qty
        state.signed_qty = remaining_qty
    else:
        state.signed_qty = next_qty
        if abs(state.signed_qty) <= LIVE_PNL_CURVE_EPSILON:
            state.signed_qty = 0.0
            state.avg_entry_price = 0.0
    state.fees_paid += abs(fill.fee)



def apply_live_pnl_funding(state: LivePnlReplayState, funding: LiveFundingEntry) -> None:
    state.funding_net += funding.amount



def live_unrealized_pnl(state: LivePnlReplayState, mark_price: float, quantity_scale: float = 1.0) -> float:
    if abs(state.signed_qty) <= LIVE_PNL_CURVE_EPSILON or state.avg_entry_price <= 0:
        return 0.0
    return state.signed_qty * (mark_price - state.avg_entry_price) * quantity_scale



def estimate_live_unrealized_quantity_scale(
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
    *,
    end_at: datetime,
    current_mark_price: float,
    current_unrealized_pnl: float,
) -> float:
    if current_mark_price <= 0:
        return 1.0

    events: list[tuple[datetime, int, LiveFill | LiveFundingEntry]] = []
    for fill in fills:
        events.append((normalize_datetime(fill.timestamp), 0, fill))
    for funding in funding_entries:
        events.append((normalize_datetime(funding.timestamp), 1, funding))
    events.sort(key=lambda item: (item[0], item[1]))

    state = LivePnlReplayState()
    end_ts = normalize_datetime(end_at)
    for timestamp, _, payload in events:
        if timestamp > end_ts:
            continue
        if isinstance(payload, LiveFill):
            apply_live_pnl_fill(state, payload)
        else:
            apply_live_pnl_funding(state, payload)

    denominator = state.signed_qty * (current_mark_price - state.avg_entry_price)
    if abs(denominator) <= LIVE_PNL_CURVE_EPSILON:
        return 1.0
    scale = current_unrealized_pnl / denominator
    return scale if math.isfinite(scale) and abs(scale) > LIVE_PNL_CURVE_EPSILON else 1.0



def build_live_pnl_curve_points(
    candles: list[Candle],
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
    *,
    start_at: datetime,
    current_timestamp: datetime,
    current_total_pnl: float,
    current_mark_price: float,
    current_unrealized_pnl: float,
) -> list[CurvePoint]:
    start_ts = normalize_datetime(start_at)
    end_ts = normalize_datetime(current_timestamp)
    if not candles:
        if start_ts == end_ts:
            return [CurvePoint(timestamp=end_ts, value=float(current_total_pnl))]
        return [
            CurvePoint(timestamp=start_ts, value=0.0),
            CurvePoint(timestamp=end_ts, value=float(current_total_pnl)),
        ]

    events: list[tuple[datetime, int, LiveFill | LiveFundingEntry]] = []
    for fill in fills:
        events.append((normalize_datetime(fill.timestamp), 0, fill))
    for funding in funding_entries:
        events.append((normalize_datetime(funding.timestamp), 1, funding))
    events.sort(key=lambda item: (item[0], item[1]))

    unrealized_quantity_scale = estimate_live_unrealized_quantity_scale(
        fills,
        funding_entries,
        end_at=end_ts,
        current_mark_price=current_mark_price,
        current_unrealized_pnl=current_unrealized_pnl,
    )

    state = LivePnlReplayState()
    curve: list[CurvePoint] = [CurvePoint(timestamp=start_ts, value=0.0)]
    event_index = 0
    for candle in candles:
        candle_ts = normalize_datetime(candle.timestamp)
        while event_index < len(events) and events[event_index][0] <= candle_ts:
            _, _, payload = events[event_index]
            if isinstance(payload, LiveFill):
                apply_live_pnl_fill(state, payload)
            else:
                apply_live_pnl_funding(state, payload)
            event_index += 1
        total_pnl = (
            state.realized_pnl
            - state.fees_paid
            + state.funding_net
            + live_unrealized_pnl(state, candle.close, unrealized_quantity_scale)
        )
        append_curve_point(curve, candle_ts, total_pnl)

    while event_index < len(events) and events[event_index][0] <= end_ts:
        _, _, payload = events[event_index]
        if isinstance(payload, LiveFill):
            apply_live_pnl_fill(state, payload)
        else:
            apply_live_pnl_funding(state, payload)
        event_index += 1

    append_curve_point(curve, end_ts, current_total_pnl)
    return downsample_curve_points(curve)



def build_live_pnl_curve(
    *,
    symbol: str,
    strategy_started_at: datetime,
    fetched_at: datetime,
    fills: list[LiveFill],
    funding_entries: list[LiveFundingEntry],
    total_pnl: float,
    current_mark_price: float,
    current_unrealized_pnl: float,
) -> list[CurvePoint]:
    start_ts = normalize_datetime(strategy_started_at)
    end_ts = normalize_datetime(fetched_at)
    if end_ts <= start_ts:
        return [CurvePoint(timestamp=end_ts, value=float(total_pnl))]

    interval = choose_live_pnl_curve_interval(start_ts, end_ts)
    lookback_days = max(1, math.ceil((end_ts - start_ts).total_seconds() / 86400.0))
    candles = load_mark_price_candles(
        DataConfig(
            source=DataSource.OKX,
            symbol=symbol,
            interval=interval,
            lookback_days=lookback_days,
            start_time=start_ts,
            end_time=end_ts,
        )
    )
    return build_live_pnl_curve_points(
        candles,
        fills,
        funding_entries,
        start_at=start_ts,
        current_timestamp=end_ts,
        current_total_pnl=total_pnl,
        current_mark_price=current_mark_price,
        current_unrealized_pnl=current_unrealized_pnl,
    )



def pick_live_strategy_side(
    *,
    position: LivePosition,
    robot: LiveRobotOverview | None,
    inferred_grid: LiveInferredGrid | None,
) -> GridSide:
    candidates = [
        inferred_grid.side.value if inferred_grid and inferred_grid.side is not None else None,
        robot.direction if robot is not None else None,
        position.side,
    ]
    for candidate in candidates:
        if candidate == "long":
            return GridSide.LONG
        if candidate == "short":
            return GridSide.SHORT
    raise DataLoadError("缺少可用的网格方向，无法逐 K 模拟收益曲线")



def pick_live_stop_loss(side: GridSide, lower: float, upper: float, robot: LiveRobotOverview | None) -> float:
    raw = robot.stop_loss_price if robot is not None else None
    if raw is not None and raw > 0:
        if side == GridSide.LONG and raw < lower:
            return raw
        if side == GridSide.SHORT and raw > upper:
            return raw
    return lower * 0.95 if side == GridSide.LONG else upper * 1.05



def build_live_simulation_strategy(
    *,
    position: LivePosition,
    robot: LiveRobotOverview | None,
    inferred_grid: LiveInferredGrid | None,
    market_params: MarketParamsResponse | None,
) -> StrategyConfig:
    side = pick_live_strategy_side(position=position, robot=robot, inferred_grid=inferred_grid)
    lower = (
        (robot.lower_price if robot and robot.lower_price and robot.lower_price > 0 else None)
        or (inferred_grid.lower if inferred_grid and inferred_grid.lower and inferred_grid.lower > 0 else None)
    )
    upper = (
        (robot.upper_price if robot and robot.upper_price and robot.upper_price > 0 else None)
        or (inferred_grid.upper if inferred_grid and inferred_grid.upper and inferred_grid.upper > 0 else None)
    )
    grids = (
        (robot.grid_count if robot and robot.grid_count and robot.grid_count >= 2 else None)
        or (inferred_grid.grid_count if inferred_grid and inferred_grid.grid_count and inferred_grid.grid_count >= 2 else None)
    )
    leverage = (
        (robot.configured_leverage if robot and robot.configured_leverage and robot.configured_leverage > 0 else None)
        or (position.leverage if position.leverage and position.leverage > 0 else None)
        or 1.0
    )
    margin = (
        (robot.investment_usdt if robot and robot.investment_usdt and robot.investment_usdt > 0 else None)
        or (position.notional / leverage if position.notional > 0 and leverage > 0 else None)
    )
    if lower is None or upper is None or upper <= lower:
        raise DataLoadError("缺少有效网格区间，无法逐 K 模拟收益曲线")
    if grids is None:
        raise DataLoadError("缺少有效网格数量，无法逐 K 模拟收益曲线")
    if margin is None or margin <= 0:
        raise DataLoadError("缺少有效投入本金，无法逐 K 模拟收益曲线")

    maker_fee = market_params.maker_fee_rate if market_params is not None else 0.0002
    taker_fee = market_params.taker_fee_rate if market_params is not None else 0.0005
    funding_rate = market_params.funding_rate_per_8h if market_params is not None else 0.0
    funding_hours = market_params.funding_interval_hours if market_params is not None else 8
    stop_loss = pick_live_stop_loss(side, lower, upper, robot)

    return StrategyConfig(
        side=side,
        lower=lower,
        upper=upper,
        grids=int(grids),
        leverage=float(leverage),
        margin=float(margin),
        stop_loss=float(stop_loss),
        use_base_position=bool(
            robot.use_base_position if robot and robot.use_base_position is not None else inferred_grid.use_base_position if inferred_grid else position.quantity > 0
        ),
        strict_risk_control=True,
        reopen_after_stop=True,
        fee_rate=float(taker_fee),
        maker_fee_rate=float(maker_fee),
        taker_fee_rate=float(taker_fee),
        slippage=0.0,
        maintenance_margin_rate=0.005,
        funding_rate_per_8h=float(funding_rate),
        funding_interval_hours=int(funding_hours),
        use_mark_price_for_liquidation=False,
        price_tick_size=float(market_params.price_tick_size) if market_params is not None else 0.0,
        quantity_step_size=float(market_params.quantity_step_size) if market_params is not None else 0.0,
        min_notional=float(market_params.min_notional) if market_params is not None else 0.0,
        max_allowed_loss_usdt=None,
    )



def build_live_simulated_pnl_curve(
    *,
    symbol: str,
    strategy_started_at: datetime,
    fetched_at: datetime,
    position: LivePosition,
    robot: LiveRobotOverview | None,
    inferred_grid: LiveInferredGrid | None,
    market_params: MarketParamsResponse | None,
    total_pnl: float,
) -> list[CurvePoint]:
    start_ts = normalize_datetime(strategy_started_at)
    end_ts = normalize_datetime(fetched_at)
    if end_ts <= start_ts:
        return [CurvePoint(timestamp=end_ts, value=float(total_pnl))]

    strategy = build_live_simulation_strategy(
        position=position,
        robot=robot,
        inferred_grid=inferred_grid,
        market_params=market_params,
    )
    interval = choose_live_pnl_curve_interval(start_ts, end_ts)
    lookback_days = max(1, math.ceil((end_ts - start_ts).total_seconds() / 86400.0))
    data_cfg = DataConfig(
        source=DataSource.OKX,
        symbol=symbol,
        interval=interval,
        lookback_days=lookback_days,
        start_time=start_ts,
        end_time=end_ts,
    )
    candles = load_candles(data_cfg)
    funding_rates = load_funding_rates(data_cfg)
    result = run_backtest(candles=candles, strategy=strategy, funding_rates=funding_rates)
    if not result.equity_curve:
        raise DataLoadError("逐 K 模拟未生成任何权益曲线点")

    raw_values = [point.value - strategy.margin for point in result.equity_curve]
    base_value = raw_values[0] if raw_values else 0.0
    normalized_values = [value - base_value for value in raw_values]
    final_value = normalized_values[-1] if normalized_values else 0.0
    scale = (total_pnl / final_value) if abs(final_value) > LIVE_PNL_CURVE_EPSILON else None

    curve: list[CurvePoint] = []
    for point, value in zip(result.equity_curve, normalized_values):
        mapped = value * scale if scale is not None else value
        append_curve_point(curve, point.timestamp, mapped)
    append_curve_point(curve, end_ts, total_pnl)
    return downsample_curve_points(curve)
