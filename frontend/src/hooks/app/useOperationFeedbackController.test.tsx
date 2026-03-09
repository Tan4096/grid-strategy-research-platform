import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "../../test-utils/renderHook";

vi.mock("../../lib/api", () => ({
  fetchOperation: vi.fn(),
  fetchOperations: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
  getApiErrorInfo: () => ({ message: "请求失败", request_id: "req-1", retryable: true })
}));

import { useOperationFeedbackController } from "./useOperationFeedbackController";

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

describe("useOperationFeedbackController", () => {
  it("keeps transient toast out of notification center", async () => {
    const hook = renderHook(() => useOperationFeedbackController());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      hook.value.showToast("参数 JSON 已复制到剪贴板。");
    });

    expect(hook.value.toastNotice?.title).toBe("参数 JSON 已复制到剪贴板。");
    expect(hook.value.operationFeedbackItems).toHaveLength(0);
  });

  it("writes notifyCenter events into notification center", async () => {
    const hook = renderHook(() => useOperationFeedbackController());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      hook.value.notifyCenter({
        kind: "history",
        category: "success",
        action: "backtest_terminal",
        title: "回测结束",
        detail: "任务结束。",
        status: "success",
        source: "backtest_runner"
      });
    });

    expect(hook.value.toastNotice).toBeNull();
    expect(hook.value.operationFeedbackItems).toHaveLength(1);
    expect(hook.value.operationFeedbackItems[0]?.title).toBe("回测结束");
  });
});
