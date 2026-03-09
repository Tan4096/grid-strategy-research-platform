import { describe, expect, it } from "vitest";
import { FALLBACK_DEFAULTS } from "./defaults";
import {
  buildBacktestPrecheck,
  cloneBacktestRequest,
  estimateMaxPossibleLossAtStop
} from "./backtestAppHelpers";

function createRequest() {
  return cloneBacktestRequest(FALLBACK_DEFAULTS);
}

describe("buildBacktestPrecheck max loss guards", () => {
  it("requires max loss input when requireMaxLossInput=true", () => {
    const request = createRequest();
    request.strategy.max_allowed_loss_usdt = null;

    const check = buildBacktestPrecheck(request, undefined, undefined, {
      requireMaxLossInput: true,
      forceMaxLossGuard: true
    });

    expect(check.errors.some((item) => item.includes("最大亏损数额为必填项"))).toBe(true);
  });

  it("does not require max loss input when strict risk control is disabled and no force options", () => {
    const request = createRequest();
    request.strategy.strict_risk_control = false;
    request.strategy.max_allowed_loss_usdt = null;

    const check = buildBacktestPrecheck(request);

    expect(check.errors.some((item) => item.includes("最大亏损数额"))).toBe(false);
    expect(check.errors.some((item) => item.includes("以损定仓"))).toBe(false);
  });

  it("enforces max loss guard even when strict risk control is disabled", () => {
    const request = createRequest();
    request.strategy.strict_risk_control = false;
    request.strategy.max_allowed_loss_usdt = 1;

    const check = buildBacktestPrecheck(request, undefined, undefined, {
      forceMaxLossGuard: true
    });

    expect(check.errors.some((item) => item.includes("以损定仓约束不满足"))).toBe(true);
  });


  it("includes the short upper-boundary pending order in max-loss estimate", () => {
    const request = createRequest();
    Object.assign(request.strategy, {
      side: "short",
      lower: 65000,
      upper: 71000,
      grids: 6,
      leverage: 15,
      margin: 1000,
      stop_loss: 72000,
      use_base_position: true,
      fee_rate: 0,
      maker_fee_rate: 0,
      taker_fee_rate: 0,
      slippage: 0,
      price_tick_size: 0,
      quantity_step_size: 0,
      min_notional: 0
    });

    const initialPrice = 70200;
    const orderNotional = (request.strategy.margin * request.strategy.leverage) / request.strategy.grids;
    const entries = [initialPrice, initialPrice, initialPrice, initialPrice, initialPrice, 71000];
    const quantities = entries.map((entry) => orderNotional / entry);
    const totalQty = quantities.reduce((sum, value) => sum + value, 0);
    const averageEntry = entries.reduce((sum, entry, index) => sum + entry * quantities[index], 0) / totalQty;
    const expectedLoss = Math.max(0, (request.strategy.stop_loss - averageEntry) * totalQty);

    expect(estimateMaxPossibleLossAtStop(request.strategy, initialPrice)).toBeCloseTo(expectedLoss, 10);
  });
  it("passes max loss guard when limit is above estimated stop loss", () => {
    const request = createRequest();
    request.strategy.strict_risk_control = false;
    const estimatedLoss = estimateMaxPossibleLossAtStop(request.strategy);
    request.strategy.max_allowed_loss_usdt = Math.ceil((estimatedLoss + 1) * 100) / 100;

    const check = buildBacktestPrecheck(request, undefined, undefined, {
      requireMaxLossInput: true,
      forceMaxLossGuard: true
    });

    expect(check.errors.some((item) => item.includes("最大亏损数额"))).toBe(false);
    expect(check.errors.some((item) => item.includes("以损定仓约束不满足"))).toBe(false);
  });
});
