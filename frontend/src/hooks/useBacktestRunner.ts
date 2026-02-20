import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelBacktest, fetchBacktestStatus, startBacktest } from "../lib/api";
import { BacktestRequest, BacktestResponse } from "../types";

interface Precheck {
  errors: string[];
  warnings: string[];
}

interface Params {
  request: BacktestRequest;
  requestReady: boolean;
  precheck: Precheck;
}

interface Result {
  result: BacktestResponse | null;
  loading: boolean;
  error: string | null;
  runBacktest: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export function useBacktestRunner({ request, requestReady, precheck }: Params): Result {
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const runNonceRef = useRef(0);

  const canRun = useMemo(() => requestReady && precheck.errors.length === 0, [precheck.errors.length, requestReady]);

  const runBacktest = useCallback(async () => {
    if (!requestReady) {
      setError("参数仍在初始化，请稍后重试。");
      return;
    }
    if (!canRun) {
      setError(precheck.errors[0] ?? "参数校验失败");
      return;
    }
    if (request.data.source === "csv" && !request.data.csv_content) {
      setError("已选择 CSV 数据源，但尚未上传 CSV 内容。");
      return;
    }
    const runNonce = runNonceRef.current + 1;
    runNonceRef.current = runNonce;
    setLoading(true);
    setError(null);
    setResult(null);

    if (jobId) {
      try {
        await cancelBacktest(jobId, { timeoutMs: 5_000 });
      } catch {
        // Ignore cancellation errors of stale jobs.
      }
    }

    try {
      const started = await startBacktest(request, { timeoutMs: 30_000 });
      if (runNonce !== runNonceRef.current) {
        return;
      }
      setJobId(started.job_id);
    } catch (err) {
      if (runNonce !== runNonceRef.current) {
        return;
      }
      const message = err instanceof Error ? err.message : "回测失败";
      setError(message);
      setLoading(false);
    }
  }, [canRun, jobId, precheck.errors, request, requestReady]);

  useEffect(() => {
    if (!jobId || !loading) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const status = await fetchBacktestStatus(jobId, {
          timeoutMs: 20_000,
          retries: 1
        });
        if (cancelled) {
          return;
        }
        if (status.job.status === "completed") {
          setResult(status.result);
          setLoading(false);
          setJobId(null);
          return;
        }
        if (status.job.status === "failed") {
          setError(status.job.error ?? status.job.message ?? "回测失败");
          setLoading(false);
          setJobId(null);
          return;
        }
        if (status.job.status === "cancelled") {
          setError(status.job.message ?? "回测已取消");
          setLoading(false);
          setJobId(null);
          return;
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "回测状态获取失败";
        setError(message);
        setLoading(false);
        setJobId(null);
        return;
      }

      const hidden = document.visibilityState !== "visible";
      timer = window.setTimeout(poll, hidden ? 3000 : 1200);
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [jobId, loading]);

  useEffect(() => {
    return () => {
      const currentJob = jobId;
      if (!currentJob) {
        return;
      }
      void cancelBacktest(currentJob, { timeoutMs: 5_000 }).catch(() => undefined);
    };
  }, [jobId]);

  return {
    result,
    loading,
    error,
    runBacktest,
    clearError: () => setError(null),
    reset: () => {
      runNonceRef.current += 1;
      setResult(null);
      setError(null);
      setLoading(false);
      setJobId((currentJob) => {
        if (currentJob) {
          void cancelBacktest(currentJob, { timeoutMs: 5_000 }).catch(() => undefined);
        }
        return null;
      });
    }
  };
}
