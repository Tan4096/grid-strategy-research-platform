import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HISTORY_UI_SESSION_KEY,
  mergeFailureQueue,
  normalizeFailedItems,
  normalizeOperationLogs,
  readHistoryUiSessionState,
  readStoredOperationLogs,
  writeHistoryUiSessionState
} from "./optimizationHistoryViewModel.shared";

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

describe("optimizationHistoryViewModel.shared", () => {
  it("normalizes failed items with fallback ids and dedupes duplicates", () => {
    expect(normalizeFailedItems([], ["job-1", "job-1", "job-2"])).toEqual([
      {
        job_id: "job-1",
        reason_code: "UNKNOWN",
        reason_message: "清空失败，未返回详细原因"
      },
      {
        job_id: "job-2",
        reason_code: "UNKNOWN",
        reason_message: "清空失败，未返回详细原因"
      }
    ]);
  });

  it("persists and restores session ui state", () => {
    window.sessionStorage.removeItem(HISTORY_UI_SESSION_KEY);
    writeHistoryUiSessionState({
      failureReasonFilter: "REQUEST_FAILED",
      failureKeyword: "job-3",
      retryBatchSize: 20,
      showFailureDetails: false,
      showAdvancedRetry: true
    });

    expect(readHistoryUiSessionState()).toEqual({
      failureReasonFilter: "REQUEST_FAILED",
      failureKeyword: "job-3",
      retryBatchSize: 20,
      showFailureDetails: false,
      showAdvancedRetry: true
    });
  });

  it("merges retry results and reads normalized operation logs from storage", () => {
    expect(
      mergeFailureQueue(
        [
          { job_id: "job-1", reason_code: "REQUEST_FAILED", reason_message: "network" },
          { job_id: "job-2", reason_code: "JOB_NOT_FINISHED", reason_message: "running" }
        ],
        ["job-1"],
        [{ job_id: "job-3", reason_code: "UNKNOWN", reason_message: "missing" }]
      )
    ).toEqual([
      { job_id: "job-2", reason_code: "JOB_NOT_FINISHED", reason_message: "running" },
      { job_id: "job-3", reason_code: "UNKNOWN", reason_message: "missing" }
    ]);

    window.localStorage.setItem(
      "btc-grid-backtest:optimization-operation-logs:v1",
      JSON.stringify([
        {
          id: "op-1",
          action: "clear",
          requested: 2,
          success: 1,
          failed: 1,
          jobIds: ["job-1", "job-1"],
          failedItems: [{ job_id: "job-2", reason_code: "REQUEST_FAILED", reason_message: "network" }],
          at: 10
        },
        {
          id: "op-1",
          action: "clear",
          requested: 3,
          success: 2,
          failed: 1,
          jobIds: ["job-3"],
          failedItems: [],
          at: 20
        }
      ])
    );

    expect(normalizeOperationLogs([])).toEqual([]);
    expect(readStoredOperationLogs()).toEqual([
      {
        id: "op-1",
        action: "clear",
        requested: 3,
        success: 2,
        failed: 1,
        jobIds: ["job-3"],
        failedItems: [],
        at: 20
      }
    ]);
  });
});
