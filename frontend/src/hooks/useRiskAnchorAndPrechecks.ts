import { useEffect, useMemo, useState } from "react";
import { fetchBacktestAnchorPrice } from "../lib/api";
import {
  buildBacktestPrecheck,
  buildOptimizationPrecheck,
  estimateInitialAverageEntryAndLiquidationPrice
} from "../lib/backtestAppHelpers";
import { OPTIMIZATION_ANCHOR_LABELS } from "../lib/appTheme";
import { AnchorMode, BacktestRequest, OptimizationConfig } from "../types";

interface UseRiskAnchorAndPrechecksParams {
  mode: "backtest" | "optimize";
  request: BacktestRequest;
  requestReady: boolean;
  optimizationConfig: OptimizationConfig;
  backtestRiskAnchorMode: AnchorMode;
  backtestRiskCustomAnchorPrice: number | null;
  forceMaxLossGuard?: boolean;
}

export function useRiskAnchorAndPrechecks({
  mode,
  request,
  requestReady,
  optimizationConfig,
  backtestRiskAnchorMode,
  backtestRiskCustomAnchorPrice,
  forceMaxLossGuard = false
}: UseRiskAnchorAndPrechecksParams) {
  const [maxLossAnchorPrice, setMaxLossAnchorPrice] = useState<number | null>(null);
  const [maxLossAnchorTime, setMaxLossAnchorTime] = useState<string | null>(null);
  const [maxLossAnchorLoading, setMaxLossAnchorLoading] = useState(false);

  const anchorDataKey = useMemo(() => {
    const data = request.data;
    return [
      data.source,
      data.symbol,
      data.interval,
      data.lookback_days,
      data.start_time ?? "",
      data.end_time ?? ""
    ].join("|");
  }, [request.data]);

  const activeRiskAnchorMode: AnchorMode =
    mode === "optimize" ? optimizationConfig.anchor_mode : backtestRiskAnchorMode;
  const activeRiskCustomAnchor = activeRiskAnchorMode === "CUSTOM_PRICE"
    ? mode === "optimize"
      ? optimizationConfig.custom_anchor_price ?? null
      : backtestRiskCustomAnchorPrice ?? null
    : null;

  useEffect(() => {
    if (!requestReady) {
      setMaxLossAnchorPrice(null);
      setMaxLossAnchorTime(null);
      setMaxLossAnchorLoading(false);
      return;
    }
    if (activeRiskAnchorMode === "CUSTOM_PRICE") {
      const customAnchor = Number(activeRiskCustomAnchor);
      if (Number.isFinite(customAnchor) && customAnchor > 0) {
        setMaxLossAnchorPrice(customAnchor);
      } else {
        setMaxLossAnchorPrice(null);
      }
      setMaxLossAnchorTime(null);
      setMaxLossAnchorLoading(false);
      return;
    }

    setMaxLossAnchorPrice(null);
    setMaxLossAnchorTime(null);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMaxLossAnchorLoading(true);
      try {
        const response = await fetchBacktestAnchorPrice(
          request.data,
          {
            signal: controller.signal,
            timeoutMs: 15_000,
            retries: 1
          },
          {
            anchor_mode: activeRiskAnchorMode
          }
        );
        setMaxLossAnchorPrice(response.anchor_price);
        setMaxLossAnchorTime(response.anchor_time);
      } catch {
        setMaxLossAnchorPrice(null);
        setMaxLossAnchorTime(null);
      } finally {
        if (!controller.signal.aborted) {
          setMaxLossAnchorLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeRiskAnchorMode,
    activeRiskCustomAnchor,
    anchorDataKey,
    request.data,
    requestReady
  ]);

  const estimatedLiqForRiskGuard = useMemo(() => {
    if (!Number.isFinite(maxLossAnchorPrice)) {
      return null;
    }
    const { estimatedLiquidationPrice } = estimateInitialAverageEntryAndLiquidationPrice(
      request.strategy,
      maxLossAnchorPrice ?? undefined
    );
    return estimatedLiquidationPrice;
  }, [request.strategy, maxLossAnchorPrice]);

  const backtestPrecheck = useMemo(
    () =>
      buildBacktestPrecheck(
        request,
        maxLossAnchorPrice ?? undefined,
        estimatedLiqForRiskGuard ?? undefined,
        forceMaxLossGuard
          ? {
              requireMaxLossInput: true,
              forceMaxLossGuard: true
            }
          : undefined
      ),
    [forceMaxLossGuard, request, maxLossAnchorPrice, estimatedLiqForRiskGuard]
  );

  const optimizationConfigWithRiskCap = useMemo(
    () => ({
      ...optimizationConfig,
      max_allowed_loss_usdt: request.strategy.max_allowed_loss_usdt ?? null
    }),
    [optimizationConfig, request.strategy.max_allowed_loss_usdt]
  );

  const optimizationRiskAnchorPrice = useMemo(() => {
    if (optimizationConfigWithRiskCap.anchor_mode !== "CUSTOM_PRICE") {
      return maxLossAnchorPrice;
    }
    const customAnchor = Number(optimizationConfigWithRiskCap.custom_anchor_price);
    if (!Number.isFinite(customAnchor) || customAnchor <= 0) {
      return null;
    }
    return customAnchor;
  }, [
    optimizationConfigWithRiskCap.anchor_mode,
    optimizationConfigWithRiskCap.custom_anchor_price,
    maxLossAnchorPrice
  ]);

  const optimizationPrecheck = useMemo(
    () =>
      buildOptimizationPrecheck(
        request,
        optimizationConfigWithRiskCap,
        optimizationRiskAnchorPrice ?? undefined,
        forceMaxLossGuard
          ? {
              requireMaxLossInput: true,
              forceMaxLossGuard: true
            }
          : undefined
      ),
    [forceMaxLossGuard, request, optimizationConfigWithRiskCap, optimizationRiskAnchorPrice]
  );

  const riskAnchorPriceForPanel =
    mode === "optimize" ? optimizationRiskAnchorPrice : maxLossAnchorPrice;
  const riskAnchorTimeForPanel =
    activeRiskAnchorMode === "CUSTOM_PRICE" ? null : maxLossAnchorTime;
  const riskAnchorLoadingForPanel =
    activeRiskAnchorMode === "CUSTOM_PRICE" ? false : maxLossAnchorLoading;
  const riskAnchorLabelForPanel = OPTIMIZATION_ANCHOR_LABELS[activeRiskAnchorMode];

  return {
    backtestPrecheck,
    optimizationConfigWithRiskCap,
    optimizationPrecheck,
    riskAnchorPriceForPanel,
    riskAnchorTimeForPanel,
    riskAnchorLoadingForPanel,
    riskAnchorLabelForPanel
  };
}
