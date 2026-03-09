import { describe, expect, it } from "vitest";
import { cloneBacktestRequest } from "../lib/backtestAppHelpers";
import { DEFAULT_OPTIMIZATION_CONFIG, FALLBACK_DEFAULTS } from "../lib/defaults";
import { renderHook } from "../test-utils/renderHook";
import { useRiskAnchorAndPrechecks } from "./useRiskAnchorAndPrechecks";

function createRequest() {
  return cloneBacktestRequest(FALLBACK_DEFAULTS);
}

function createOptimizationConfig() {
  return {
    ...DEFAULT_OPTIMIZATION_CONFIG
  };
}

describe("useRiskAnchorAndPrechecks backtest max loss guard", () => {
  it("does not block backtest by max loss when strict risk control is disabled", () => {
    const request = createRequest();
    request.strategy.strict_risk_control = false;
    request.strategy.max_allowed_loss_usdt = null;

    const hook = renderHook(() =>
      useRiskAnchorAndPrechecks({
        mode: "backtest",
        request,
        requestReady: true,
        optimizationConfig: createOptimizationConfig(),
        backtestRiskAnchorMode: "CUSTOM_PRICE",
        backtestRiskCustomAnchorPrice: 65000
      })
    );

    expect(
      hook.value.backtestPrecheck.errors.some(
        (item) => item.includes("最大亏损数额") || item.includes("以损定仓")
      )
    ).toBe(false);
    expect(
      hook.value.backtestPrecheck.warnings.some(
        (item) => item.includes("严格风控已关闭")
      )
    ).toBe(true);
    hook.unmount();
  });

  it("blocks backtest by max loss when strict risk control is enabled", () => {
    const request = createRequest();
    request.strategy.strict_risk_control = true;
    request.strategy.max_allowed_loss_usdt = null;

    const hook = renderHook(() =>
      useRiskAnchorAndPrechecks({
        mode: "backtest",
        request,
        requestReady: true,
        optimizationConfig: createOptimizationConfig(),
        backtestRiskAnchorMode: "CUSTOM_PRICE",
        backtestRiskCustomAnchorPrice: 65000
      })
    );

    expect(
      hook.value.backtestPrecheck.errors.some(
        (item) => item.includes("最大亏损数额") || item.includes("以损定仓")
      )
    ).toBe(true);
    hook.unmount();
  });

  it("forces max loss guard when the force flag is enabled", () => {
    const request = createRequest();
    request.strategy.strict_risk_control = false;
    request.strategy.max_allowed_loss_usdt = null;

    const hook = renderHook(() =>
      useRiskAnchorAndPrechecks({
        mode: "backtest",
        request,
        requestReady: true,
        optimizationConfig: createOptimizationConfig(),
        backtestRiskAnchorMode: "CUSTOM_PRICE",
        backtestRiskCustomAnchorPrice: 65000,
        forceMaxLossGuard: true
      })
    );

    expect(hook.value.backtestPrecheck.errors.some((item) => item.includes("最大亏损数额为必填项"))).toBe(true);
    hook.unmount();
  });
});
