import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "../test-utils/renderHook";
import {
  OPERATION_FEEDBACK_CLEARED_AT_STORAGE_KEY,
  OPERATION_FEEDBACK_STORAGE_KEY,
  pruneOperationFeedbackItems,
  readOperationFeedbackFromStorage,
  useOperationFeedback
} from "./useOperationFeedback";

const originalLocalStorage = window.localStorage;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (memory.has(key) ? memory.get(key) ?? null : null),
      setItem: (key: string, value: string) => {
        memory.set(key, String(value));
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      }
    }
  });
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: originalLocalStorage
  });
  vi.useRealTimers();
});

describe("useOperationFeedback", () => {
  it("deduplicates repeated feedback emitted in a short window", () => {
    const hook = renderHook(() => useOperationFeedback());
    act(() => {
      hook.value.emitOperationEvent({
        title: "批量清空完成",
        detail: "成功 2 条，失败 0 条",
        action: "clear_selected",
        status: "success"
      });
      hook.value.emitOperationEvent({
        title: "批量清空完成",
        detail: "成功 2 条，失败 0 条",
        action: "clear_selected",
        status: "success"
      });
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(1);
    hook.unmount();
  });

  it("persists items and supports dismiss/clear", () => {
    const hook = renderHook(() => useOperationFeedback());
    act(() => {
      hook.value.emitOperationEvent({ title: "A", action: "mock_a", status: "success" });
      hook.value.emitOperationEvent({ title: "B", action: "mock_b", status: "failed", category: "error" });
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(2);

    const firstId = hook.value.operationFeedbackItems[0].id;
    act(() => {
      hook.value.dismissOperationFeedback(firstId);
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(1);

    act(() => {
      hook.value.clearOperationFeedback();
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(0);
    hook.unmount();
  });

  it("upserts fixed-id events and supports dismiss by id", () => {
    const hook = renderHook(() => useOperationFeedback());
    act(() => {
      hook.value.emitOperationEvent({
        id: "live-sync:stop_loss_risk",
        title: "止损距离过近",
        detail: "BTCUSDT · 当前距止损仅 3.20%",
        action: "live_attention_stop_loss_risk",
        status: "partial_failed",
        category: "warning",
        source: "live_trading"
      });
      hook.value.emitOperationEvent({
        id: "live-sync:stop_loss_risk",
        title: "止损距离过近",
        detail: "BTCUSDT · 当前距止损仅 2.80%",
        action: "live_attention_stop_loss_risk",
        status: "partial_failed",
        category: "warning",
        source: "live_trading"
      });
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(1);
    expect(hook.value.operationFeedbackItems[0]?.detail).toContain("2.80%");

    act(() => {
      hook.value.emitOperationEvent({
        id: "live-sync:stop_loss_risk",
        dismiss: true,
        title: "",
        action: "live_attention_stop_loss_risk"
      });
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(0);
    hook.unmount();
  });

  it("does not rewrite unchanged fixed-id events", () => {
    const hook = renderHook(() => useOperationFeedback());
    act(() => {
      hook.value.emitOperationEvent({
        id: "live-sync:stop_loss_risk",
        title: "止损距离过近",
        detail: "BTCUSDT · 当前距止损仅 3.20%",
        action: "live_attention_stop_loss_risk",
        status: "partial_failed",
        category: "warning",
        source: "live_trading"
      });
    });
    hook.rerender();

    const firstItem = hook.value.operationFeedbackItems[0];
    expect(firstItem).toBeTruthy();

    act(() => {
      hook.value.emitOperationEvent({
        id: "live-sync:stop_loss_risk",
        title: "止损距离过近",
        detail: "BTCUSDT · 当前距止损仅 3.20%",
        action: "live_attention_stop_loss_risk",
        status: "partial_failed",
        category: "warning",
        source: "live_trading"
      });
    });
    hook.rerender();

    expect(hook.value.operationFeedbackItems).toHaveLength(1);
    expect(hook.value.operationFeedbackItems[0]).toEqual(firstItem);
    hook.unmount();
  });

  it("reads persisted feedback from localStorage", () => {
    const now = new Date("2026-02-27T00:00:00.000Z").toISOString();
    window.localStorage.setItem(
      OPERATION_FEEDBACK_STORAGE_KEY,
      JSON.stringify([
        {
          id: "persisted-1",
          type: "success",
          action: "restore_selected",
          title: "恢复成功",
          detail: "已恢复 3 条",
          status: "done",
          created_at: now,
          updated_at: now
        }
      ])
    );

    const persisted = readOperationFeedbackFromStorage();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].title).toBe("恢复成功");
  });

  it("prunes expired feedback items", () => {
    const nowMs = Date.parse("2026-02-27T00:00:00.000Z");
    const pruned = pruneOperationFeedbackItems(
      [
        {
          id: "expired",
          category: "info",
          action: "mock_expired",
          title: "old",
          detail: null,
          status: "success",
          created_at: "2026-02-01T00:00:00.000Z",
          updated_at: "2026-02-01T00:00:00.000Z"
        },
        {
          id: "valid",
          category: "info",
          action: "mock_valid",
          title: "new",
          detail: null,
          status: "success",
          created_at: "2026-02-26T23:00:00.000Z",
          updated_at: "2026-02-26T23:00:00.000Z"
        }
      ],
      nowMs
    );

    expect(pruned.map((item) => item.id)).toEqual(["valid"]);
  });

  it("does not replay old notice after remount", () => {
    const first = renderHook(() => useOperationFeedback());
    act(() => {
      first.value.emitOperationEvent({
        title: "已完成操作",
        action: "mock_done",
        status: "success"
      });
    });
    expect(first.value.latestOperationFeedback?.title).toBe("已完成操作");
    first.unmount();

    const second = renderHook(() => useOperationFeedback());
    expect(second.value.operationFeedbackItems).toHaveLength(1);
    expect(second.value.latestOperationFeedback).toBeNull();
    second.unmount();
  });

  it("merges backend operation replay without triggering top notice", () => {
    const hook = renderHook(() => useOperationFeedback());
    act(() => {
      hook.value.mergeOperationRecords([
        {
          operation_id: "op-1",
          action: "clear_selected",
          status: "partial_failed",
          requested: 2,
          success: 1,
          failed: 1,
          skipped: 0,
          job_ids: ["a", "b"],
          failed_items: [
            {
              job_id: "b",
              reason_code: "REQUEST_FAILED",
              reason_message: "mock failed"
            }
          ],
          summary_text: "清空完成：成功 1 条，失败 1 条。",
          request_id: "req-op-1",
          created_at: "2026-02-27T00:00:00.000Z",
          updated_at: "2026-02-27T00:00:00.000Z",
          meta: { retryable: true }
        }
      ]);
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(1);
    expect(hook.value.latestOperationFeedback).toBeNull();
    expect(hook.value.operationFeedbackItems[0].operation_id).toBe("op-1");
    hook.unmount();
  });

  it("upserts operation replay by operation_id", () => {
    const hook = renderHook(() => useOperationFeedback());
    act(() => {
      hook.value.mergeOperationRecords([
        {
          operation_id: "op-1",
          action: "clear_selected",
          status: "partial_failed",
          requested: 2,
          success: 1,
          failed: 1,
          skipped: 0,
          job_ids: ["a", "b"],
          failed_items: [],
          summary_text: "清空完成：成功 1 条，失败 1 条。",
          request_id: "req-op-1",
          created_at: "2026-02-27T00:00:00.000Z",
          updated_at: "2026-02-27T00:00:00.000Z",
          meta: { retryable: true }
        }
      ]);
      hook.value.upsertOperationRecord({
        operation_id: "op-1",
        action: "clear_selected",
        status: "success",
        requested: 2,
        success: 2,
        failed: 0,
        skipped: 0,
        job_ids: ["a", "b"],
        failed_items: [],
        summary_text: "清空完成：成功 2 条，失败 0 条。",
        request_id: "req-op-1",
        created_at: "2026-02-27T00:00:00.000Z",
        updated_at: "2026-02-27T00:01:00.000Z",
        meta: { retryable: false }
      });
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(1);
    expect(hook.value.operationFeedbackItems[0].status).toBe("success");
    expect(hook.value.operationFeedbackItems[0].title).toBe("历史已清理");
    hook.unmount();
  });

  it("does not re-add cleared items from older backend replay", () => {
    const hook = renderHook(() => useOperationFeedback());
    act(() => {
      hook.value.emitOperationEvent({
        title: "旧事件",
        action: "mock_old",
        status: "success"
      });
      hook.value.clearOperationFeedback();
      hook.value.mergeOperationRecords([
        {
          operation_id: "op-old",
          action: "clear_selected",
          status: "success",
          requested: 1,
          success: 1,
          failed: 0,
          skipped: 0,
          job_ids: ["x"],
          failed_items: [],
          summary_text: "旧回放事件",
          request_id: "req-old",
          created_at: "2026-02-01T00:00:00.000Z",
          updated_at: "2026-02-01T00:00:00.000Z",
          meta: { retryable: false }
        }
      ]);
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(0);
    expect(window.localStorage.getItem(OPERATION_FEEDBACK_CLEARED_AT_STORAGE_KEY)).toBeTruthy();
    hook.unmount();
  });

  it("still accepts newer backend replay after clear", () => {
    const hook = renderHook(() => useOperationFeedback());
    const newer = new Date(Date.now() + 10_000).toISOString();
    act(() => {
      hook.value.clearOperationFeedback();
      hook.value.mergeOperationRecords([
        {
          operation_id: "op-new",
          action: "clear_selected",
          status: "success",
          requested: 1,
          success: 1,
          failed: 0,
          skipped: 0,
          job_ids: ["x"],
          failed_items: [],
          summary_text: "新回放事件",
          request_id: "req-new",
          created_at: newer,
          updated_at: newer,
          meta: { retryable: false }
        }
      ]);
    });
    hook.rerender();
    expect(hook.value.operationFeedbackItems).toHaveLength(1);
    expect(hook.value.operationFeedbackItems[0].operation_id).toBe("op-new");
    hook.unmount();
  });
});
