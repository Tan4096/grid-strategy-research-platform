import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError, fetchLiveRobotList, getApiErrorInfo } from "../lib/api";
import {
  LiveConnectionDraft,
  LiveExchange,
  LiveRobotListItem,
  LiveRobotListScope
} from "../types";
import { NOTICE_ADVICE, buildNoticeDetail } from "../lib/notificationCopy";
import type { EmitOperationEventInput } from "./useOperationFeedback";

interface Params {
  draft: LiveConnectionDraft;
  exchange: LiveExchange | null;
  active: boolean;
  ready: boolean;
  scope: LiveRobotListScope;
  notifyCenter?: (message: string | EmitOperationEventInput) => void;
}

interface Result {
  items: LiveRobotListItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLiveRobotList({
  draft,
  exchange,
  active,
  ready,
  scope,
  notifyCenter
}: Params): Result {
  const credentials = draft.profiles.okx;
  const [items, setItems] = useState<LiveRobotListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastLoadedKeyRef = useRef<string | null>(null);

  const requestKey = useMemo(
    () =>
      [exchange ?? "", scope, credentials.api_key, credentials.api_secret, credentials.passphrase ?? ""].join("|"),
    [credentials.api_key, credentials.api_secret, credentials.passphrase, exchange, scope]
  );

  const canRequest = useMemo(
    () =>
      Boolean(
        ready &&
          exchange === "okx" &&
          credentials.api_key.trim() &&
          credentials.api_secret.trim() &&
          (credentials.passphrase ?? "").trim()
      ),
    [credentials.api_key, credentials.api_secret, credentials.passphrase, exchange, ready]
  );

  const performRefresh = useCallback(async () => {
    if (!canRequest || loading) {
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetchLiveRobotList(
        {
          exchange: "okx",
          scope,
          credentials: {
            api_key: credentials.api_key,
            api_secret: credentials.api_secret,
            passphrase: credentials.passphrase ?? null
          }
        },
        {
          signal: controller.signal,
          timeoutMs: 20_000,
          retries: 1
        }
      );
      setItems(response.items ?? []);
      setError(null);
      notifyCenter?.({
        id: "live-sync:robot-list",
        dismiss: true,
        kind: "state",
        title: "",
        action: "live_robot_list_fetch",
        source: "live_trading"
      });
      lastLoadedKeyRef.current = requestKey;
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const info = getApiErrorInfo(err);
      setItems([]);
      setError(info.message);
      notifyCenter?.({
        id: "live-sync:robot-list",
        kind: "state",
        category: err instanceof ApiRequestError && err.status < 500 ? "warning" : "error",
        action: "live_robot_list_fetch",
        title: "监测对象列表同步异常",
        detail: buildNoticeDetail("监测对象", `列表拉取失败：${info.message}`, NOTICE_ADVICE.retryLater),
        status: "failed",
        request_id: info.request_id,
        retryable: info.retryable,
        source: "live_trading"
      });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setLoading(false);
    }
  }, [canRequest, credentials.api_key, credentials.api_secret, credentials.passphrase, loading, notifyCenter, requestKey, scope]);

  useEffect(() => {
    if (!canRequest) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      lastLoadedKeyRef.current = null;
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (!active) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setLoading(false);
      return;
    }
    if (lastLoadedKeyRef.current === requestKey) {
      return;
    }
    void performRefresh();
  }, [active, canRequest, performRefresh, requestKey]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    []
  );

  return {
    items,
    loading,
    error,
    refresh: performRefresh
  };
}
