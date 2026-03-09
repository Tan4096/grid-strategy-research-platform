import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { fetchOperation, fetchOperations, getApiErrorInfo } from "../../lib/api";
import { NOTICE_ADVICE, buildNoticeDetail } from "../../lib/notificationCopy";
import type { OperationEventCategory } from "../../types";
import {
  type EmitOperationEventInput,
  useOperationFeedback
} from "../useOperationFeedback";

export interface ToastNotice {
  id: string;
  title: string;
  detail: string | null;
  category: OperationEventCategory;
}

export interface OperationFeedbackController {
  operationFeedbackItems: ReturnType<typeof useOperationFeedback>["operationFeedbackItems"];
  activeOperationFeedbackCount: number;
  latestOperationFeedback: ReturnType<typeof useOperationFeedback>["latestOperationFeedback"];
  dismissOperationFeedback: ReturnType<typeof useOperationFeedback>["dismissOperationFeedback"];
  dismissLatestNotice: ReturnType<typeof useOperationFeedback>["dismissLatestNotice"];
  clearOperationFeedback: ReturnType<typeof useOperationFeedback>["clearOperationFeedback"];
  operationDrawerOpen: boolean;
  setOperationDrawerOpen: Dispatch<SetStateAction<boolean>>;
  operationFeedbackOpenSignal: number;
  openOperationFeedbackDrawer: () => void;
  handleLoadOperationDetail: (operationId: string) => Promise<void>;
  showToast: (message: string | EmitOperationEventInput) => void;
  toastNotice: ToastNotice | null;
  dismissToast: (id: string) => void;
  notifyCenter: (message: string | EmitOperationEventInput) => void;
}

function normalizeToastCategory(input: EmitOperationEventInput): OperationEventCategory {
  const category = input.category ?? input.type;
  if (category === "success" || category === "warning" || category === "error") {
    return category;
  }
  return "info";
}

function buildToastNotice(input: string | EmitOperationEventInput): ToastNotice | null {
  if (typeof input === "string") {
    const title = input.trim();
    if (!title) {
      return null;
    }
    return {
      id: `toast:${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      detail: null,
      category: "info"
    };
  }
  const title = input.title.trim();
  if (!title) {
    return null;
  }
  return {
    id: input.id?.trim() || `toast:${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    detail: input.detail?.trim() || null,
    category: normalizeToastCategory(input)
  };
}

export function useOperationFeedbackController(): OperationFeedbackController {
  const [operationFeedbackOpenSignal, setOperationFeedbackOpenSignal] = useState(0);
  const [operationDrawerOpen, setOperationDrawerOpen] = useState(false);
  const [toastNotice, setToastNotice] = useState<ToastNotice | null>(null);
  const operationReplayInitializedRef = useRef(false);

  const {
    operationFeedbackItems,
    latestOperationFeedback,
    emitOperationEvent,
    dismissOperationFeedback,
    dismissLatestNotice,
    clearOperationFeedback,
    mergeOperationRecords,
    upsertOperationRecord
  } = useOperationFeedback();

  const showToast = useCallback((input: string | EmitOperationEventInput) => {
    const next = buildToastNotice(input);
    if (!next) {
      return;
    }
    setToastNotice(next);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToastNotice((current) => (current?.id === id ? null : current));
  }, []);

  const notifyCenter = useCallback(
    (input: string | EmitOperationEventInput) => {
      if (typeof input === "string") {
        const title = input.trim();
        if (!title) {
          return;
        }
        emitOperationEvent({
          kind: "history",
          category: "info",
          action: "ui_notice",
          title,
          status: "success",
          source: "ui"
        });
        return;
      }
      emitOperationEvent({
        kind: input.kind ?? (input.id ? "state" : "history"),
        category: input.category ?? input.type ?? "info",
        action: input.action ?? "ui_notice",
        status: input.status ?? "success",
        source: input.source ?? "ui",
        ...input
      });
    },
    [emitOperationEvent]
  );

  const syncOperationReplay = useCallback(async () => {
    try {
      const page = await fetchOperations(30, null, null, null, {
        timeoutMs: 20_000,
        retries: 1
      });
      if (page.items.length > 0) {
        mergeOperationRecords(page.items);
      }
    } catch (err) {
      const errorInfo = getApiErrorInfo(err);
      showToast({
        category: "warning",
        action: "operation_replay_sync",
        title: "操作记录同步失败，稍后将自动重试。",
        detail: buildNoticeDetail("通知中心", `记录同步失败：${errorInfo.message}`, NOTICE_ADVICE.retryLater),
        status: "partial_failed",
        request_id: errorInfo.request_id,
        retryable: errorInfo.retryable ?? true,
        source: "operation_center"
      });
    }
  }, [mergeOperationRecords, showToast]);

  useEffect(() => {
    if (operationReplayInitializedRef.current) {
      return;
    }
    operationReplayInitializedRef.current = true;
    void syncOperationReplay();
  }, [syncOperationReplay]);

  useEffect(() => {
    if (!operationDrawerOpen) {
      return;
    }
    let cancelled = false;
    const pullLatest = async () => {
      if (cancelled) {
        return;
      }
      await syncOperationReplay();
    };
    void pullLatest();
    const timer = window.setInterval(() => {
      void pullLatest();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [operationDrawerOpen, syncOperationReplay]);

  const handleLoadOperationDetail = useCallback(
    async (operationId: string) => {
      const detail = await fetchOperation(operationId, {
        timeoutMs: 20_000,
        retries: 1
      });
      upsertOperationRecord(detail);
    },
    [upsertOperationRecord]
  );

  const openOperationFeedbackDrawer = useCallback(() => {
    setOperationFeedbackOpenSignal((value) => value + 1);
  }, []);

  const activeOperationFeedbackCount = useMemo(
    () => operationFeedbackItems.filter((item) => item.kind === "state").length,
    [operationFeedbackItems]
  );

  return {
    operationFeedbackItems,
    activeOperationFeedbackCount,
    latestOperationFeedback,
    dismissOperationFeedback,
    dismissLatestNotice,
    clearOperationFeedback,
    operationDrawerOpen,
    setOperationDrawerOpen,
    operationFeedbackOpenSignal,
    openOperationFeedbackDrawer,
    handleLoadOperationDetail,
    showToast,
    toastNotice,
    dismissToast,
    notifyCenter
  };
}
