import type { BacktestRequest, LiveSnapshotResponse } from "../lib/api-schema";

function alignIsoToMinute(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setSeconds(0, 0);
  return parsed.toISOString();
}

export function buildLiveAlignedBacktestRequest(
  request: BacktestRequest,
  snapshot: LiveSnapshotResponse
): BacktestRequest {
  const alignedEndTime = alignIsoToMinute(snapshot.window?.compared_end_at ?? snapshot.account.fetched_at);
  const alignedStartTime = snapshot.window?.strategy_started_at ?? snapshot.account.strategy_started_at;

  return {
    ...request,
    data: {
      ...request.data,
      source: snapshot.market_params?.source ?? snapshot.account.exchange,
      symbol: snapshot.account.symbol,
      start_time: alignedStartTime,
      end_time: alignedEndTime
    },
    strategy: {
      ...request.strategy,
      side:
        snapshot.inferred_grid.side ??
        (snapshot.position.side === "flat" ? request.strategy.side : snapshot.position.side),
      lower: snapshot.inferred_grid.lower ?? request.strategy.lower,
      upper: snapshot.inferred_grid.upper ?? request.strategy.upper,
      grids: snapshot.inferred_grid.grid_count ?? request.strategy.grids,
      leverage:
        snapshot.robot.configured_leverage ??
        snapshot.position.leverage ??
        request.strategy.leverage,
      stop_loss:
        snapshot.robot.stop_loss_price ?? request.strategy.stop_loss,
      use_base_position: snapshot.inferred_grid.use_base_position ?? request.strategy.use_base_position,
      fee_rate: snapshot.market_params?.taker_fee_rate ?? request.strategy.fee_rate,
      maker_fee_rate: snapshot.market_params?.maker_fee_rate ?? request.strategy.maker_fee_rate,
      taker_fee_rate: snapshot.market_params?.taker_fee_rate ?? request.strategy.taker_fee_rate,
      funding_rate_per_8h: snapshot.market_params?.funding_rate_per_8h ?? request.strategy.funding_rate_per_8h,
      funding_interval_hours: snapshot.market_params?.funding_interval_hours ?? request.strategy.funding_interval_hours,
      price_tick_size: snapshot.market_params?.price_tick_size ?? request.strategy.price_tick_size,
      quantity_step_size: snapshot.market_params?.quantity_step_size ?? request.strategy.quantity_step_size,
      min_notional: snapshot.market_params?.min_notional ?? request.strategy.min_notional
    }
  };
}
