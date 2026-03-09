import { describe, expect, it } from "vitest";
import {
  normalizeBacktestStartResponse,
  normalizeJobStreamUpdate,
  normalizeOptimizationHistoryClearResponse,
  normalizeOptimizationStartResponse
} from "./api-contract";

describe("api-contract", () => {
  it("normalizes POST /backtest/start response", () => {
    const normalized = normalizeBacktestStartResponse({
      job_id: "bt-1",
      status: "pending",
      idempotency_reused: true
    });

    expect(normalized).toEqual({
      job_id: "bt-1",
      status: "pending",
      idempotency_reused: true
    });
  });

  it("normalizes POST /optimization/start response", () => {
    const normalized = normalizeOptimizationStartResponse({
      job_id: "opt-1",
      status: "running",
      total_combinations: 42,
      idempotency_reused: false
    });

    expect(normalized.job_id).toBe("opt-1");
    expect(normalized.total_combinations).toBe(42);
    expect(normalized.idempotency_reused).toBe(false);
  });

  it("normalizes DELETE /optimization-history/selected response with fallback", () => {
    const requestedIds = ["a", "b", "c"];
    const normalized = normalizeOptimizationHistoryClearResponse(
      {
        requested: 3,
        deleted: 2,
        failed_job_ids: ["c"],
        failed_items: [{ job_id: "c", reason_code: "LOCKED", reason_message: "locked" }],
        operation_id: "op-1",
        undo_until: "2026-02-27T12:00:00Z",
        summary_text: "请求 3 条，成功 2 条，失败 1 条",
        request_id: "req-1",
        meta: { retryable: true, scope: "history" }
      },
      requestedIds
    );

    expect(normalized.requested).toBe(3);
    expect(normalized.deleted).toBe(2);
    expect(normalized.failed).toBe(1);
    expect(normalized.failed_job_ids).toEqual(["c"]);
    expect(normalized.deleted_job_ids).toEqual(["a", "b"]);
    expect(normalized.operation_id).toBe("op-1");
    expect(normalized.undo_until).toBe("2026-02-27T12:00:00Z");
    expect(normalized.summary_text).toContain("请求 3 条");
    expect(normalized.request_id).toBe("req-1");
    expect(normalized.meta?.retryable).toBe(true);
  });

  it("normalizes stream payload object", () => {
    const update = normalizeJobStreamUpdate<{ foo: string }>({
      job_id: "job-1",
      job_type: "optimization",
      status: "RUNNING",
      progress: 66,
      terminal: false,
      payload: { foo: "bar" }
    });

    expect(update).toEqual({
      job_id: "job-1",
      job_type: "optimization",
      status: "running",
      progress: 66,
      terminal: false,
      payload: { foo: "bar" }
    });
  });
});
