import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { fetchMarketParams } from "../lib/api";
import type { BacktestRequest } from "../lib/api-schema";

interface Params {
  request: BacktestRequest;
  setRequest: Dispatch<SetStateAction<BacktestRequest>>;
  enabled?: boolean;
}

interface Result {
  marketParamsSyncing: boolean;
  marketParamsNote: string | null;
  syncMarketParams: (sourceOverride?: BacktestRequest["data"]["source"], symbolOverride?: string) => Promise<void>;
}

export function useMarketSync({ request, setRequest, enabled = true }: Params): Result {
  const [marketParamsSyncing, setMarketParamsSyncing] = useState(false);
  const [marketParamsNote, setMarketParamsNote] = useState<string | null>(null);
  const marketParamsControllerRef = useRef<AbortController | null>(null);

  const syncMarketParams = useCallback(
    async (sourceOverride?: BacktestRequest["data"]["source"], symbolOverride?: string) => {
      if (!enabled) {
        setMarketParamsSyncing(false);
        setMarketParamsNote("当前环境未启用交易所参数同步。");
        return;
      }
      const source = sourceOverride ?? request.data.source;
      const symbol = (symbolOverride ?? request.data.symbol ?? "BTCUSDT").trim().toUpperCase();

      if (!symbol || symbol.length < 6) {
        marketParamsControllerRef.current?.abort();
        marketParamsControllerRef.current = null;
        setMarketParamsSyncing(false);
        setMarketParamsNote("请输入完整交易对（例如 BTCUSDT）。");
        return;
      }

      setMarketParamsSyncing(true);
      marketParamsControllerRef.current?.abort();
      const controller = new AbortController();
      marketParamsControllerRef.current = controller;

      try {
        const market = await fetchMarketParams(source, symbol, {
          signal: controller.signal,
          timeoutMs: 20_000,
          retries: 2
        });
        setRequest((prev) => ({
          ...prev,
          strategy: {
            ...prev.strategy,
            fee_rate: market.taker_fee_rate,
            maker_fee_rate: market.maker_fee_rate,
            taker_fee_rate: market.taker_fee_rate,
            funding_rate_per_8h: market.funding_rate_per_8h,
            funding_interval_hours: market.funding_interval_hours,
            price_tick_size: market.price_tick_size,
            quantity_step_size: market.quantity_step_size,
            min_notional: market.min_notional
          }
        }));

        const syncInfo = `${source.toUpperCase()} ${symbol} @ ${new Date(market.fetched_at).toLocaleTimeString()}`;
        setMarketParamsNote(market.note ? `${syncInfo}（部分字段为回退值）` : `${syncInfo}（已自动同步）`);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        const message = err instanceof Error ? err.message : "未知错误";
        setMarketParamsNote(`交易所参数同步失败：${message}`);
      } finally {
        if (marketParamsControllerRef.current === controller) {
          marketParamsControllerRef.current = null;
          setMarketParamsSyncing(false);
        }
      }
    },
    [enabled, request.data.source, request.data.symbol, setRequest]
  );

  useEffect(() => {
    if (!enabled) {
      marketParamsControllerRef.current?.abort();
      marketParamsControllerRef.current = null;
      setMarketParamsSyncing(false);
      setMarketParamsNote("当前环境未启用交易所参数同步。");
      return;
    }
    const source = request.data.source;
    const symbol = (request.data.symbol ?? "").trim();
    if (!source || !symbol) {
      return;
    }
    if (symbol.length < 6) {
      return;
    }
    syncMarketParams(source, symbol);
  }, [enabled, request.data.source, request.data.symbol, syncMarketParams]);

  useEffect(
    () => () => {
      marketParamsControllerRef.current?.abort();
      marketParamsControllerRef.current = null;
    },
    []
  );

  return {
    marketParamsSyncing,
    marketParamsNote,
    syncMarketParams
  };
}
