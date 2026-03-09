import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptimizationProgressResponse, OptimizationStatusResponse } from "../../lib/api-schema";
import type { OptimizationHistoryClearResult } from "../../lib/operation-models";
import { renderHook } from "../../test-utils/renderHook";
import { HISTORY_UI_SESSION_KEY } from "./optimizationHistoryViewModel.shared";
import { useOptimizationHistoryViewModel } from "./useOptimizationHistoryViewModel";

const originalLocalStorage = window.localStorage;
const originalSessionStorage = window.sessionStorage;

beforeEach(() => {
  const localMemory = new Map<string, string>();
  const sessionMemory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (localMemory.has(key) ? localMemory.get(key) ?? null : null),
      setItem: (key: string, value: string) => {
        localMemory.set(key, String(value));
      },
      removeItem: (key: string) => {
        localMemory.delete(key);
      },
      clear: () => {
        localMemory.clear();
      }
    }
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (sessionMemory.has(key) ? sessionMemory.get(key) ?? null : null),
      setItem: (key: string, value: string) => {
        sessionMemory.set(key, String(value));
      },
      removeItem: (key: string) => {
        sessionMemory.delete(key);
      },
      clear: () => {
        sessionMemory.clear();
      }
    }
  });
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: originalLocalStorage
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: originalSessionStorage
  });
});

function buildHistory(jobId: string, status: "failed" | "completed" = "failed"): OptimizationProgressResponse {
  return {
    job: {
      job_id: jobId,
      status,
      created_at: "2026-03-07T10:00:00+08:00",
      started_at: "2026-03-07T10:01:00+08:00",
      finished_at: status === "completed" ? "2026-03-07T10:05:00+08:00" : null,
      progress: status === "completed" ? 100 : 80,
      total_steps: 100,
      completed_steps: status === "completed" ? 100 : 80,
      message: null,
      error: status === "failed" ? "boom" : null,
      total_combinations: 100,
      trials_completed: 80,
      trials_pruned: 5,
      pruning_ratio: 0.05
    },
    target: "total_return"
  };
}

function buildClearResult(): OptimizationHistoryClearResult {
  return {
    requested: 3,
    deleted: 1,
    failed: 2,
    deleted_job_ids: ["job-1"],
    failed_job_ids: ["job-2", "job-3"],
    failed_items: [
      {
        job_id: "job-2",
        reason_code: "REQUEST_FAILED",
        reason_message: "network"
      },
      {
        job_id: "job-3",
        reason_code: "JOB_NOT_FINISHED",
        reason_message: "running"
      }
    ],
    skipped: 0,
    soft_delete_ttl_hours: 48,
    operation_id: "op-1",
    undo_until: "2026-03-09T10:00:00+08:00",
    summary_text: "已删除 1 条，失败 2 条",
    request_id: "req-1",
    meta: {
      retryable: true
    }
  };
}

const optimizationStatus: OptimizationStatusResponse | null = null;

describe("useOptimizationHistoryViewModel", () => {
  it("restores session state on mount", () => {
    window.sessionStorage.setItem(
      HISTORY_UI_SESSION_KEY,
      JSON.stringify({
        failureReasonFilter: "REQUEST_FAILED",
        failureKeyword: "job-2",
        retryBatchSize: 25,
        showFailureDetails: false,
        showAdvancedRetry: true
      })
    );

    const hook = renderHook(() =>
      useOptimizationHistoryViewModel({
        optimizationStatus,
        optimizationHistory: [buildHistory("job-1")],
        optimizationHistoryLoading: false,
        optimizationHistoryHasMore: false,
        onRefreshOptimizationHistory: () => undefined,
        onLoadMoreOptimizationHistory: () => undefined,
        onClearOptimizationHistory: async () => buildClearResult(),
        onRestoreOptimizationHistory: async () => ({
          requested: 0,
          restored: 0,
          failed: 0,
          restored_job_ids: [],
          failed_job_ids: [],
          failed_items: []
        }),
        onLoadOptimizationHistoryJob: () => undefined,
        onRestartOptimizationHistoryJob: () => undefined,
        onApplyOptimizationRow: () => undefined,
        onCopyLiveParams: () => Promise.resolve()
      })
    );

    expect(hook.value.failureReasonFilter).toBe("REQUEST_FAILED");
    expect(hook.value.failureKeyword).toBe("job-2");
    expect(hook.value.retryBatchSize).toBe(25);
    expect(hook.value.showFailureDetails).toBe(false);
    expect(hook.value.showAdvancedRetry).toBe(true);

    hook.unmount();
  });

  it("captures clear feedback, classifies retry queues and supports undo selection", async () => {
    const onClear = vi.fn().mockResolvedValue(buildClearResult());
    const hook = renderHook(() =>
      useOptimizationHistoryViewModel({
        optimizationStatus,
        optimizationHistory: [buildHistory("job-1"), buildHistory("job-2"), buildHistory("job-3")],
        optimizationHistoryLoading: false,
        optimizationHistoryHasMore: false,
        onRefreshOptimizationHistory: () => undefined,
        onLoadMoreOptimizationHistory: () => undefined,
        onClearOptimizationHistory: onClear,
        onRestoreOptimizationHistory: async () => ({
          requested: 0,
          restored: 0,
          failed: 0,
          restored_job_ids: [],
          failed_job_ids: [],
          failed_items: []
        }),
        onLoadOptimizationHistoryJob: () => undefined,
        onRestartOptimizationHistoryJob: () => undefined,
        onApplyOptimizationRow: () => undefined,
        onCopyLiveParams: () => Promise.resolve()
      })
    );

    act(() => {
      hook.value.toggleSelectAll();
    });
    expect(hook.value.selectedCount).toBe(3);

    await act(async () => {
      await hook.value.clearHistory();
    });

    expect(onClear).toHaveBeenCalledWith(["job-1", "job-2", "job-3"]);
    expect(hook.value.clearFeedback?.failed).toBe(2);
    expect(hook.value.selectedByJobId).toEqual({ "job-2": true, "job-3": true });
    expect(hook.value.failureReasonGroups.map((item) => item.reasonCode)).toEqual([
      "JOB_NOT_FINISHED",
      "REQUEST_FAILED"
    ]);
    expect(hook.value.fastRetryIds).toEqual(["job-2"]);
    expect(hook.value.refreshRetryIds).toEqual(["job-3"]);
    expect(hook.value.operationLog).toHaveLength(1);

    act(() => {
      hook.value.setFailureReasonFilter("JOB_NOT_FINISHED");
    });
    expect(hook.value.filteredFailureIds).toEqual(["job-3"]);

    act(() => {
      hook.value.setFailureReasonFilter("ALL");
      hook.value.setFailureKeyword("job-2");
    });
    expect(hook.value.filteredFailureIds).toEqual(["job-2"]);

    act(() => {
      hook.value.undoLastSelection();
    });
    expect(hook.value.selectedCount).toBe(3);

    hook.unmount();
  });
});
