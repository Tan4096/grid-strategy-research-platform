import type { AnchorMode, BacktestAnchorPriceResponse, BacktestRequest, BacktestResponse, BacktestStartResponse, BacktestStatusResponse, DataConfig, MarketParamsResponse } from "../../lib/api-schema";
import {
  ApiBacktestAnchorPriceRequest,
  ApiBacktestAnchorPriceResponse,
  ApiBacktestStartRequest,
  ApiBacktestStartResponse,
  ApiBacktestStatusResponse,
  ApiFetchDefaultsResponse,
  ApiMarketParamsResponse,
  ApiRunBacktestRequest,
  ApiRunBacktestResponse,
  normalizeBacktestStartResponse
} from "../api-contract";
import {
  generateIdempotencyKey,
  requestJson,
  type RequestOptions
} from "./core";

export async function fetchDefaults(options?: RequestOptions): Promise<BacktestRequest> {
  const response = await requestJson<ApiFetchDefaultsResponse>("/api/v1/backtest/defaults", { method: "GET" }, options);
  return response as BacktestRequest;
}

export async function runBacktest(
  payload: BacktestRequest,
  options?: RequestOptions
): Promise<BacktestResponse> {
  const response = await requestJson<ApiRunBacktestResponse>(
    "/api/v1/backtest/run",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload as ApiRunBacktestRequest)
    },
    options
  );
  return response as BacktestResponse;
}

export async function startBacktest(
  payload: BacktestRequest,
  options?: RequestOptions
): Promise<BacktestStartResponse> {
  const response = await requestJson<ApiBacktestStartResponse>(
    "/api/v1/backtest/start",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": generateIdempotencyKey()
      },
      body: JSON.stringify(payload as ApiBacktestStartRequest)
    },
    options
  );
  return normalizeBacktestStartResponse(response);
}

export async function fetchBacktestAnchorPrice(
  payload: DataConfig,
  options?: RequestOptions,
  anchorOptions?: { anchor_mode?: AnchorMode; custom_anchor_price?: number | null }
): Promise<BacktestAnchorPriceResponse> {
  const query = new URLSearchParams();
  if (anchorOptions?.anchor_mode) {
    query.set("anchor_mode", anchorOptions.anchor_mode);
  }
  if (
    anchorOptions?.custom_anchor_price !== null &&
    anchorOptions?.custom_anchor_price !== undefined &&
    Number.isFinite(anchorOptions.custom_anchor_price)
  ) {
    query.set("custom_anchor_price", String(anchorOptions.custom_anchor_price));
  }
  const queryText = query.toString();
  const response = await requestJson<ApiBacktestAnchorPriceResponse>(
    `/api/v1/backtest/anchor-price${queryText ? `?${queryText}` : ""}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload as ApiBacktestAnchorPriceRequest)
    },
    options
  );
  return response as BacktestAnchorPriceResponse;
}

export async function fetchBacktestStatus(
  jobId: string,
  options?: RequestOptions
): Promise<BacktestStatusResponse> {
  const response = await requestJson<ApiBacktestStatusResponse>(`/api/v1/backtest/${jobId}`, { method: "GET" }, options);
  return response as BacktestStatusResponse;
}

export async function cancelBacktest(
  jobId: string,
  options?: RequestOptions
): Promise<{ job_id: string; status: string }> {
  return requestJson<{ job_id: string; status: string }>(
    `/api/v1/backtest/${jobId}/cancel`,
    { method: "POST" },
    options
  );
}

export async function fetchMarketParams(
  source: string,
  symbol: string,
  options?: RequestOptions
): Promise<MarketParamsResponse> {
  const query = new URLSearchParams({
    source,
    symbol
  });
  const response = await requestJson<ApiMarketParamsResponse>(
    `/api/v1/market/params?${query.toString()}`,
    { method: "GET" },
    options
  );
  return response as MarketParamsResponse;
}
