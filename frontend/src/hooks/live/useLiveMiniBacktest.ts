import { useEffect, useMemo, useRef, useState } from "react";
import { runBacktest } from "../../lib/api";
import { buildLiveAlignedBacktestRequest } from "../../lib/liveBacktestAlignment";
import type { BacktestRequest, BacktestResponse, LiveSnapshotResponse } from "../../lib/api-schema";

interface Params {
  request: BacktestRequest;
  snapshot: LiveSnapshotResponse | null;
  windowDays?: number;
}

interface Result {
  result: BacktestResponse | null;
  loading: boolean;
  error: string | null;
}

function buildRecentWindowRequest(request: BacktestRequest, snapshot: LiveSnapshotResponse, windowDays: number): BacktestRequest {
  const aligned = buildLiveAlignedBacktestRequest(request, snapshot);
  const endRaw = aligned.data.end_time ?? snapshot.window?.compared_end_at ?? snapshot.account.fetched_at;
  const end = new Date(endRaw);
  const strategyStart = new Date(snapshot.window?.strategy_started_at ?? snapshot.account.strategy_started_at);
  if (Number.isNaN(end.getTime()) || Number.isNaN(strategyStart.getTime())) {
    return aligned;
  }
  const recentStart = new Date(end);
  recentStart.setUTCDate(recentStart.getUTCDate() - Math.max(1, Math.round(windowDays)));
  const finalStart = strategyStart.getTime() > recentStart.getTime() ? strategyStart : recentStart;
  finalStart.setUTCSeconds(0, 0);
  return {
    ...aligned,
    data: {
      ...aligned.data,
      start_time: finalStart.toISOString(),
      end_time: end.toISOString()
    }
  };
}


export function useLiveMiniBacktest({ request, snapshot, windowDays = 30 }: Params): Result {
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signatureRef = useRef<string | null>(null);
  const runNonceRef = useRef(0);

  const alignedRequest = useMemo(
    () => (snapshot ? buildRecentWindowRequest(request, snapshot, windowDays) : null),
    [request, snapshot, windowDays]
  );
  const signature = useMemo(
    () => (alignedRequest ? JSON.stringify(alignedRequest) : null),
    [alignedRequest]
  );

  useEffect(() => {
    if (!alignedRequest || !signature) {
      setResult(null);
      setLoading(false);
      setError(null);
      signatureRef.current = null;
      return;
    }
    if (signatureRef.current === signature) {
      return;
    }
    signatureRef.current = signature;
    const controller = new AbortController();
    const runNonce = runNonceRef.current + 1;
    runNonceRef.current = runNonce;
    setLoading(true);
    setError(null);

    void runBacktest(alignedRequest, { signal: controller.signal, timeoutMs: 60_000 })
      .then((nextResult) => {
        if (controller.signal.aborted || runNonce !== runNonceRef.current) {
          return;
        }
        setResult(nextResult);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || runNonce !== runNonceRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : "隐藏回测失败");
        setLoading(false);
      });

    return () => controller.abort();
  }, [alignedRequest, signature]);

  return { result, loading, error };
}
