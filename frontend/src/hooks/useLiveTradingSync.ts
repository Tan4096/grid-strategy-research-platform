import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePollingLifecycle } from "./usePollingLifecycle";
import { ApiRequestError, fetchLiveSnapshot, getApiErrorInfo } from "../lib/api";
import { detectLiveMonitoringNotifications } from "../lib/liveMonitoringNotifications";
import { NOTICE_ADVICE, buildNoticeDetail } from "../lib/notificationCopy";
import { STORAGE_KEYS } from "../lib/storage";
import type { LiveConnectionDraft, LiveMonitoringTrendPoint } from "../types";
import type { LiveExchange, LiveRobotListScope, LiveSnapshotResponse } from "../lib/api-schema";
import type { EmitOperationEventInput } from "./useOperationFeedback";

const MAX_TREND_POINTS = 4096;

interface Params {
  draft: LiveConnectionDraft;
  exchange: LiveExchange | null;
  symbol: string;
  strategyStartedAt: string | null;
  active: boolean;
  ready: boolean;
  monitoringEnabled: boolean;
  pollIntervalSec: number;
  monitoringScope: LiveRobotListScope;
  onMonitoringEnabledChange?: (next: boolean) => void;
  notifyCenter?: (message: string | EmitOperationEventInput) => void;
  showToast?: (message: string | EmitOperationEventInput) => void;
}

interface Result {
  snapshot: LiveSnapshotResponse | null;
  loading: boolean;
  error: string | null;
  autoRefreshPaused: boolean;
  autoRefreshPausedReason: string | null;
  monitoringActive: boolean;
  nextRefreshAt: number | null;
  trend: LiveMonitoringTrendPoint[];
  refresh: () => Promise<void>;
  stop: () => void;
  clearError: () => void;
}

type TrendHistoryMap = Record<string, LiveMonitoringTrendPoint[]>;

function normalizeTrendPoint(raw: unknown): LiveMonitoringTrendPoint | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<LiveMonitoringTrendPoint>;
  if (typeof candidate.timestamp !== "string" || !candidate.timestamp.trim()) {
    return null;
  }
  return {
    timestamp: candidate.timestamp,
    total_pnl: typeof candidate.total_pnl === "number" ? candidate.total_pnl : 0,
    floating_profit: typeof candidate.floating_profit === "number" ? candidate.floating_profit : 0,
    funding_fee: typeof candidate.funding_fee === "number" ? candidate.funding_fee : 0,
    notional: typeof candidate.notional === "number" ? candidate.notional : 0,
    mark_price: typeof candidate.mark_price === "number" && Number.isFinite(candidate.mark_price) ? candidate.mark_price : undefined
  };
}

function compactTrendPoints(points: LiveMonitoringTrendPoint[]): LiveMonitoringTrendPoint[] {
  let current = [...points];
  while (current.length > MAX_TREND_POINTS) {
    const splitIndex = Math.max(2, Math.floor(current.length * 0.6));
    const older = current.slice(0, splitIndex);
    const recent = current.slice(splitIndex);
    current = [
      ...older.filter((_, index) => index === 0 || index === older.length - 1 || index % 2 === 0),
      ...recent
    ];
  }
  return current;
}

function readTrendStorageRaw(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const localRaw = window.localStorage.getItem(STORAGE_KEYS.liveMonitoringTrendHistory);
    if (localRaw) {
      return localRaw;
    }
  } catch {
    // ignore local storage failures
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEYS.liveMonitoringTrendHistory);
  } catch {
    return null;
  }
}

function readTrendHistoryMap(): TrendHistoryMap {
  const raw = readTrendStorageRaw();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized: TrendHistoryMap = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!Array.isArray(value)) {
        return;
      }
      normalized[key] = compactTrendPoints(
        value
          .map((item) => normalizeTrendPoint(item))
          .filter((item): item is LiveMonitoringTrendPoint => item !== null)
      );
    });
    return normalized;
  } catch {
    return {};
  }
}

function writeTrendHistoryMap(value: TrendHistoryMap): void {
  if (typeof window === "undefined") {
    return;
  }
  const serialized = JSON.stringify(value);
  try {
    window.localStorage.setItem(STORAGE_KEYS.liveMonitoringTrendHistory, serialized);
  } catch {
    // ignore local storage failures
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.liveMonitoringTrendHistory, serialized);
  } catch {
    // ignore session storage failures
  }
}

function appendTrendPoint(points: LiveMonitoringTrendPoint[], nextPoint: LiveMonitoringTrendPoint): LiveMonitoringTrendPoint[] {
  const cloned = [...points];
  const last = cloned[cloned.length - 1];
  if (last && last.timestamp === nextPoint.timestamp) {
    cloned[cloned.length - 1] = nextPoint;
    return compactTrendPoints(cloned);
  }
  cloned.push(nextPoint);
  return compactTrendPoints(cloned);
}

function buildTrendPoint(snapshot: LiveSnapshotResponse): LiveMonitoringTrendPoint {
  return {
    timestamp: snapshot.account.fetched_at,
    total_pnl: snapshot.robot.total_pnl ?? snapshot.summary.total_pnl,
    floating_profit: snapshot.robot.floating_profit ?? snapshot.summary.unrealized_pnl,
    funding_fee: snapshot.robot.funding_fee ?? snapshot.summary.funding_net,
    notional: snapshot.position.notional || snapshot.summary.position_notional,
    mark_price:
      snapshot.market_params?.reference_price ??
      (Number.isFinite(snapshot.position.mark_price) && snapshot.position.mark_price > 0
        ? snapshot.position.mark_price
        : snapshot.position.entry_price)
  };
}

export function useLiveTradingSync({
  draft,
  exchange,
  symbol,
  strategyStartedAt,
  active,
  ready,
  monitoringEnabled,
  pollIntervalSec,
  monitoringScope,
  onMonitoringEnabledChange,
  notifyCenter,
  showToast
}: Params): Result {
  const credentials = exchange === "okx" ? draft.profiles.okx : null;
  const algoId = draft.algo_id.trim();
  const [snapshot, setSnapshot] = useState<LiveSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [autoRefreshPausedReason, setAutoRefreshPausedReason] = useState<string | null>(null);
  const [trend, setTrend] = useState<LiveMonitoringTrendPoint[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const trendHistoryMapRef = useRef<TrendHistoryMap>({});
  const snapshotRef = useRef<LiveSnapshotResponse | null>(null);

  const requestKey = useMemo(
    () =>
      [
        exchange ?? "",
        symbol.trim().toUpperCase(),
        strategyStartedAt ?? "",
        algoId,
        credentials?.api_key ?? "",
        credentials?.api_secret ?? "",
        credentials?.passphrase ?? ""
      ].join("|"),
    [algoId, credentials?.api_key, credentials?.api_secret, credentials?.passphrase, exchange, strategyStartedAt, symbol]
  );

  const trendKey = useMemo(
    () => [exchange ?? "", symbol.trim().toUpperCase(), strategyStartedAt ?? "", algoId].join("|"),
    [algoId, exchange, strategyStartedAt, symbol]
  );

  const canRequest = useMemo(
    () =>
      Boolean(
        ready &&
          exchange === "okx" &&
          symbol.trim() &&
          strategyStartedAt?.trim() &&
          algoId &&
          credentials?.api_key.trim() &&
          credentials?.api_secret.trim() &&
          (credentials?.passphrase ?? "").trim()
      ),
    [algoId, credentials?.api_key, credentials?.api_secret, credentials?.passphrase, exchange, ready, strategyStartedAt, symbol]
  );

  const updateTrend = useCallback((nextSnapshot: LiveSnapshotResponse) => {
    const nextPoint = buildTrendPoint(nextSnapshot);
    setTrend((prev) => {
      const next = appendTrendPoint(prev, nextPoint);
      trendHistoryMapRef.current = {
        ...trendHistoryMapRef.current,
        [trendKey]: next
      };
      writeTrendHistoryMap(trendHistoryMapRef.current);
      return next;
    });
  }, [trendKey]);

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
      const next = await fetchLiveSnapshot(
        {
          exchange: "okx",
          symbol: symbol.trim().toUpperCase(),
          strategy_started_at: strategyStartedAt as string,
          algo_id: algoId,
          monitoring_poll_interval_sec: pollIntervalSec,
          monitoring_scope: monitoringScope,
          credentials: {
            api_key: credentials?.api_key ?? "",
            api_secret: credentials?.api_secret ?? "",
            passphrase: credentials?.passphrase ?? null
          }
        },
        {
          signal: controller.signal,
          timeoutMs: 20_000,
          retries: 1
        }
      );
      const previousSnapshot = snapshotRef.current;
      setSnapshot(next);
      snapshotRef.current = next;
      updateTrend(next);
      setAutoRefreshPaused(false);
      setAutoRefreshPausedReason(null);
      notifyCenter?.({
        id: "live-sync:fetch",
        dismiss: true,
        kind: "state",
        title: "",
        action: "live_snapshot_refresh",
        source: "live_trading"
      });
      detectLiveMonitoringNotifications(previousSnapshot, next).forEach((item) => {
        if (item.delivery === "center") {
          notifyCenter?.(item);
          return;
        }
        showToast?.(item);
      });
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const info = getApiErrorInfo(err);
      setError(info.message);
      const shouldPause = err instanceof ApiRequestError && [400, 401, 429].includes(err.status);
      if (shouldPause) {
        setAutoRefreshPaused(true);
        setAutoRefreshPausedReason(info.message);
      }
      notifyCenter?.({
        id: "live-sync:fetch",
        kind: "state",
        category: shouldPause ? "warning" : "error",
        action: "live_snapshot_refresh",
        title: shouldPause ? "实盘监测同步异常" : "实盘数据同步异常",
        detail: buildNoticeDetail(
          symbol.trim().toUpperCase() || "实盘监测",
          `${shouldPause ? "同步受限" : "快照拉取失败"}：${info.message}`,
          shouldPause ? NOTICE_ADVICE.retryLater : NOTICE_ADVICE.retryLater
        ),
        status: shouldPause ? "partial_failed" : "failed",
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
  }, [
    algoId,
    canRequest,
    credentials?.api_key,
    credentials?.api_secret,
    credentials?.passphrase,
    loading,
    monitoringScope,
    notifyCenter,
    pollIntervalSec,
    showToast,
    strategyStartedAt,
    symbol,
    updateTrend
  ]);

  const refresh = useCallback(async () => {
    onMonitoringEnabledChange?.(true);
    setAutoRefreshPaused(false);
    setAutoRefreshPausedReason(null);
    await performRefresh();
  }, [onMonitoringEnabledChange, performRefresh]);

  const canAutoRefresh = Boolean(active && canRequest && monitoringEnabled && !autoRefreshPaused);

  const resumeRefresh = useCallback(() => {
    if (!canAutoRefresh) {
      return;
    }
    void performRefresh();
  }, [canAutoRefresh, performRefresh]);

  const { clear: clearTimer, nextRunAt: nextRefreshAt, schedule: schedulePollingRefresh } = usePollingLifecycle({
    enabled: canAutoRefresh,
    onResume: resumeRefresh
  });

  useEffect(() => {
    trendHistoryMapRef.current = readTrendHistoryMap();
    setTrend(trendHistoryMapRef.current[trendKey] ?? []);
  }, [trendKey]);

  useEffect(() => {
    if (!canRequest) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      clearTimer();
      setAutoRefreshPaused(false);
      setAutoRefreshPausedReason(null);
      setError(null);
      setLoading(false);
      setSnapshot(null);
      snapshotRef.current = null;
    }
  }, [canRequest, clearTimer]);

  useEffect(() => {
    clearTimer();
    setSnapshot(null);
    snapshotRef.current = null;
    setError(null);
    setAutoRefreshPaused(false);
    setAutoRefreshPausedReason(null);
  }, [clearTimer, requestKey]);

  useEffect(() => {
    if (!canAutoRefresh) {
      clearTimer();
      return;
    }

    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }
      schedulePollingRefresh(pollIntervalSec * 1000, () => {
        if (cancelled) {
          return;
        }
        void performRefresh().finally(() => {
          scheduleNext();
        });
      });
    };

    if (!snapshot) {
      void performRefresh();
    }
    scheduleNext();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [canAutoRefresh, clearTimer, performRefresh, pollIntervalSec, schedulePollingRefresh, snapshot]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      clearTimer();
    },
    [clearTimer]
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearTimer();
    setLoading(false);
    setAutoRefreshPaused(false);
    setAutoRefreshPausedReason(null);
    onMonitoringEnabledChange?.(false);
  }, [clearTimer, onMonitoringEnabledChange]);

  return {
    snapshot,
    loading,
    error,
    autoRefreshPaused,
    autoRefreshPausedReason,
    monitoringActive: Boolean(monitoringEnabled && canRequest && !autoRefreshPaused),
    nextRefreshAt,
    trend,
    refresh,
    stop,
    clearError: () => setError(null)
  };
}
