import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { fetchMarketParams } from "../lib/api";
import { BacktestRequest } from "../types";

interface Params {
  request: BacktestRequest;
  setRequest: Dispatch<SetStateAction<BacktestRequest>>;
}

interface Result {
  marketParamsSyncing: boolean;
  marketParamsNote: string | null;
  syncMarketParams: (sourceOverride?: BacktestRequest["data"]["source"], symbolOverride?: string) => Promise<void>;
}

export function useMarketSync({ request, setRequest }: Params): Result {
  const [marketParamsSyncing, setMarketParamsSyncing] = useState(false);
  const [marketParamsNote, setMarketParamsNote] = useState<string | null>(null);
  const marketParamsControllerRef = useRef<AbortController | null>(null);

  const syncMarketParams = useCallback(
    async (sourceOverride?: BacktestRequest["data"]["source"], symbolOverride?: string) => {
      const source = sourceOverride ?? request.data.source;
      const symbol = (symbolOverride ?? request.data.symbol ?? "BTCUSDT").toUpperCase();

      if (source === "csv") {
        marketParamsControllerRef.current?.abort();
        marketParamsControllerRef.current = null;
        setMarketParamsSyncing(false);
        setMarketParamsNote("CSV 数据源不自动同步交易所参数。");
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
    [request.data.source, request.data.symbol, setRequest]
  );

  useEffect(() => {
    if (!request.data.source || !request.data.symbol) {
      return;
    }
    syncMarketParams(request.data.source, request.data.symbol);
  }, [request.data.source, request.data.symbol, syncMarketParams]);

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
