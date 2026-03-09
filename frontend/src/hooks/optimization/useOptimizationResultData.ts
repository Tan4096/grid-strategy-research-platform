import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect } from "react";
import type { OptimizationResultTab } from "../../components/OptimizationPanel";
import {
  fetchOptimizationHeatmap,
  fetchOptimizationRows,
  fetchOptimizationStatus
} from "../../lib/api";
import type { OptimizationStatusResponse, SortOrder } from "../../lib/api-schema";
import { mergeOptimizationJobMeta } from "../useOptimizationPolling";

interface Params {
  optimizationJobId: string | null;
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationPage: number;
  optimizationPageSize: number;
  optimizationSortBy: string;
  optimizationSortOrder: SortOrder;
  optimizationResultTab: OptimizationResultTab;
  setOptimizationStatus: Dispatch<SetStateAction<OptimizationStatusResponse | null>>;
  setOptimizationError: (value: string | null) => void;
  refetchedRowsForJobRef: MutableRefObject<string | null>;
}

export function useOptimizationResultData({
  optimizationJobId,
  optimizationStatus,
  optimizationPage,
  optimizationPageSize,
  optimizationSortBy,
  optimizationSortOrder,
  optimizationResultTab,
  setOptimizationStatus,
  setOptimizationError,
  refetchedRowsForJobRef
}: Params): void {
  const mergeRowsPayload = useCallback(
    (
      rowsPayload: Awaited<ReturnType<typeof fetchOptimizationRows>>,
      prev: OptimizationStatusResponse | null
    ): OptimizationStatusResponse => ({
      job: mergeOptimizationJobMeta(prev?.job, rowsPayload.job),
      target: rowsPayload.target,
      sort_by: rowsPayload.sort_by,
      sort_order: rowsPayload.sort_order,
      page: rowsPayload.page,
      page_size: rowsPayload.page_size,
      total_results: rowsPayload.total_results,
      rows: rowsPayload.rows,
      best_row: rowsPayload.best_row,
      best_validation_row: rowsPayload.best_validation_row,
      best_equity_curve: prev?.best_equity_curve ?? [],
      best_score_progression: prev?.best_score_progression ?? [],
      convergence_curve_data: prev?.convergence_curve_data ?? [],
      heatmap: prev?.heatmap ?? [],
      train_window: prev?.train_window ?? null,
      validation_window: prev?.validation_window ?? null
    }),
    []
  );

  useEffect(() => {
    if (!optimizationJobId) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    fetchOptimizationRows(
      optimizationJobId,
      optimizationPage,
      optimizationPageSize,
      optimizationSortBy,
      optimizationSortOrder,
      {
        signal: controller.signal,
        timeoutMs: 20_000,
        retries: 1
      }
    )
      .then((rowsPayload) => {
        if (cancelled) {
          return;
        }
        setOptimizationStatus((prev) => mergeRowsPayload(rowsPayload, prev));
        setOptimizationError(null);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "获取优化结果失败";
        setOptimizationError(message);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    mergeRowsPayload,
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    setOptimizationError,
    setOptimizationStatus
  ]);

  useEffect(() => {
    if (!optimizationJobId || !optimizationStatus) {
      return;
    }
    const jobStatus = optimizationStatus.job?.status;
    const terminal =
      jobStatus === "completed" || jobStatus === "failed" || jobStatus === "cancelled";
    if (!terminal) {
      return;
    }
    const rowsLength = Array.isArray(optimizationStatus.rows) ? optimizationStatus.rows.length : 0;
    if (rowsLength > 0) {
      return;
    }
    if (refetchedRowsForJobRef.current === optimizationJobId) {
      return;
    }

    refetchedRowsForJobRef.current = optimizationJobId;

    let cancelled = false;
    fetchOptimizationStatus(
      optimizationJobId,
      optimizationPage,
      optimizationPageSize,
      optimizationSortBy,
      optimizationSortOrder,
      { timeoutMs: 20_000, retries: 2 }
    )
      .then((status) => {
        if (!cancelled) {
          setOptimizationStatus(() => status);
        }
      })
      .catch(() => {
        // keep existing status when terminal refetch fails
      });

    return () => {
      cancelled = true;
    };
  }, [
    optimizationJobId,
    optimizationPage,
    optimizationPageSize,
    optimizationSortBy,
    optimizationSortOrder,
    optimizationStatus,
    refetchedRowsForJobRef,
    setOptimizationStatus
  ]);

  useEffect(() => {
    if (!optimizationJobId || optimizationResultTab !== "heatmap") {
      return;
    }

    let cancelled = false;
    fetchOptimizationHeatmap(optimizationJobId, { timeoutMs: 20_000, retries: 1 })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setOptimizationStatus((prev) => {
          if (!prev) {
            return null;
          }
          return {
            ...prev,
            job: mergeOptimizationJobMeta(prev.job, payload.job),
            target: payload.target,
            heatmap: payload.heatmap,
            best_row: payload.best_row ?? prev.best_row
          };
        });
      })
      .catch(() => {
        // keep previous status when heatmap refresh fails
      });

    return () => {
      cancelled = true;
    };
  }, [optimizationJobId, optimizationResultTab, setOptimizationStatus]);
}
