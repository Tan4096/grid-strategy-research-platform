import { useEffect, useMemo, useRef, useState } from "react";
import type { TouchEvent } from "react";
import { OperationEvent } from "../../types";
import { STORAGE_KEYS } from "../../lib/storage";

interface Props {
  items: OperationEvent[];
  latestItem?: OperationEvent | null;
  isMobileViewport: boolean;
  onDismiss: (id: string) => void;
  onDismissNotice?: (id: string) => void;
  onClear: () => void;
  onDrawerOpenChange?: (open: boolean) => void;
  onLoadOperationDetail?: (operationId: string) => Promise<void>;
  mobileEntryMode?: "floating" | "external";
  externalOpenSignal?: number;
}

function normalizeKind(item: OperationEvent): "state" | "history" {
  return item.kind === "state" ? "state" : "history";
}

function typeClass(type: OperationEvent["category"]): string {
  const toneByType: Record<OperationEvent["category"], string> = {
    info: "border-[color:rgba(var(--accent-rgb),0.4)] bg-slate-900 text-slate-100",
    success: "border-emerald-500/40 bg-slate-900 text-slate-100",
    warning: "border-amber-500/50 bg-slate-900 text-slate-100",
    error: "border-rose-500/50 bg-slate-900 text-slate-100"
  };
  return toneByType[type];
}

function stripeClass(type: OperationEvent["category"]): string {
  if (type === "success") {
    return "border-l-4 border-l-emerald-400";
  }
  if (type === "warning") {
    return "border-l-4 border-l-amber-400";
  }
  if (type === "error") {
    return "border-l-4 border-l-rose-400";
  }
  return "border-l-4 border-l-cyan-400";
}

const DRAWER_OPEN_STORAGE_KEY = "btc-grid-backtest:operation-center-drawer-open:v1";

export default function OperationFeedbackCenter({
  items,
  isMobileViewport,
  onDismiss,
  onClear,
  onDrawerOpenChange,
  onLoadOperationDetail,
  mobileEntryMode = "floating",
  externalOpenSignal = 0
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.sessionStorage.getItem(DRAWER_OPEN_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [unreadCount, setUnreadCount] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 0;
    }
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEYS.operationCenterUnread);
      const value = Number(raw);
      return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    } catch {
      return 0;
    }
  });
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const [detailLoadingByOpId, setDetailLoadingByOpId] = useState<Record<string, true>>({});
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [expandedById, setExpandedById] = useState<Record<string, true>>({});
  const lastExternalOpenSignalRef = useRef<number>(externalOpenSignal);
  const lastSeenItemIdRef = useRef<string | null>(null);
  const hasItems = items.length > 0;
  const showFloatingEntry = !isMobileViewport && mobileEntryMode === "floating";
  const panelTitle = useMemo(() => `通知中心 (${items.length})`, [items.length]);

  const stateItems = useMemo(
    () =>
      [...items]
        .filter((item) => normalizeKind(item) === "state")
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)),
    [items]
  );
  const activeItemCount = stateItems.length;

  const historyItems = useMemo(
    () =>
      [...items]
        .filter((item) => normalizeKind(item) !== "state")
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
    [items]
  );

  useEffect(() => {
    if (externalOpenSignal <= lastExternalOpenSignalRef.current) {
      return;
    }
    lastExternalOpenSignalRef.current = externalOpenSignal;
    setDrawerOpen(true);
  }, [externalOpenSignal]);

  useEffect(() => {
    const newestId = items[0]?.id ?? null;
    if (!newestId) {
      lastSeenItemIdRef.current = null;
      return;
    }
    if (drawerOpen) {
      lastSeenItemIdRef.current = newestId;
      return;
    }
    if (lastSeenItemIdRef.current && lastSeenItemIdRef.current !== newestId) {
      setUnreadCount((count) => count + 1);
    }
    lastSeenItemIdRef.current = newestId;
  }, [drawerOpen, items]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    setUnreadCount(0);
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.sessionStorage.setItem(STORAGE_KEYS.operationCenterUnread, String(unreadCount));
    } catch {
      // ignore
    }
  }, [unreadCount]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.sessionStorage.setItem(DRAWER_OPEN_STORAGE_KEY, drawerOpen ? "1" : "0");
    } catch {
      // ignore
    }
    onDrawerOpenChange?.(drawerOpen);
  }, [drawerOpen, onDrawerOpenChange]);

  useEffect(() => {
    if (!copiedRequestId) {
      return;
    }
    const timer = window.setTimeout(() => setCopiedRequestId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedRequestId]);

  const toggleDrawer = () => {
    setDrawerOpen((prev) => !prev);
  };

  const toggleItemExpanded = (id: string) => {
    setExpandedById((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: true };
    });
  };

  const copyRequestId = async (requestId: string) => {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopiedRequestId(requestId);
    } catch {
      setCopiedRequestId(null);
    }
  };

  const loadDetail = async (operationId: string) => {
    if (!onLoadOperationDetail || detailLoadingByOpId[operationId]) {
      return;
    }
    setDetailLoadingByOpId((prev) => ({ ...prev, [operationId]: true }));
    try {
      await onLoadOperationDetail(operationId);
    } finally {
      setDetailLoadingByOpId((prev) => {
        const next = { ...prev };
        delete next[operationId];
        return next;
      });
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (!isMobileViewport) {
      return;
    }
    setTouchStartY(event.touches[0]?.clientY ?? null);
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (!isMobileViewport || touchStartY === null) {
      return;
    }
    const endY = event.changedTouches[0]?.clientY ?? touchStartY;
    if (endY - touchStartY > 70) {
      setDrawerOpen(false);
    }
    setTouchStartY(null);
  };

  const renderItem = (item: OperationEvent) => {
    const hasExtraDetails = Boolean(item.operation_id || item.request_id || item.failed_items?.length);
    const expanded = expandedById[item.id] === true;
    return (
      <div
        key={item.id}
        className={`rounded border px-3 py-2 text-xs ${typeClass(item.category)} ${stripeClass(item.category)}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{item.title}</p>
            {item.detail && <p className="mt-0.5 break-words text-slate-300/95">{item.detail}</p>}
          </div>
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-xs h-6 min-h-0 px-2"
            onClick={() => onDismiss(item.id)}
            aria-label="移除通知"
          >
            ×
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>{new Date(item.created_at).toLocaleString()}</span>
          {hasExtraDetails && (
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs h-6 min-h-0 px-2"
              onClick={() => toggleItemExpanded(item.id)}
            >
              {expanded ? "收起" : "详情"}
            </button>
          )}
        </div>
        {expanded && hasExtraDetails && (
          <div className="mt-2 space-y-2 border-t border-slate-700/60 pt-2 text-[11px] text-slate-300">
            {item.failed_items && item.failed_items.length > 0 && (
              <p>失败项 {item.failed_items.length} 条</p>
            )}
            {item.operation_id && onLoadOperationDetail && (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-xs h-6 min-h-0 px-2"
                disabled={detailLoadingByOpId[item.operation_id] === true}
                onClick={() => void loadDetail(item.operation_id!)}
              >
                {detailLoadingByOpId[item.operation_id] ? "同步中..." : "同步详情"}
              </button>
            )}
            {item.request_id && (
              <div className="flex items-center gap-2 break-all">
                <span>request_id: {item.request_id}</span>
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-xs h-6 min-h-0 px-2"
                  onClick={() => void copyRequestId(item.request_id!)}
                >
                  {copiedRequestId === item.request_id ? "已复制" : "复制"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {showFloatingEntry && (
        <button
          type="button"
          className={`fixed z-[4990] ui-btn ui-btn-secondary ui-btn-xs ${isMobileViewport ? "right-2" : "bottom-4 right-4"}`}
          style={
            isMobileViewport
              ? {
                  bottom: "calc(env(safe-area-inset-bottom) + var(--mobile-bottom-reserved, 0px) + 0.5rem)"
                }
              : undefined
          }
          onClick={toggleDrawer}
        >
          通知中心 {activeItemCount > 0 ? `(${activeItemCount})` : ""}
        </button>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-[5100] bg-slate-950/85" onClick={() => setDrawerOpen(false)}>
          <aside
            className={`absolute flex flex-col bg-slate-900 shadow-2xl ${
              isMobileViewport
                ? "inset-x-0 bottom-0 top-[4%] rounded-t-xl border-t border-slate-700/80"
                : "bottom-0 right-0 top-0 w-[420px] border-l border-slate-700/80"
            }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {isMobileViewport && (
              <div className="flex justify-center py-1.5">
                <span className="h-1 w-10 rounded-full bg-slate-600/90" />
              </div>
            )}
            <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
              <p className="text-sm font-semibold text-slate-100">{panelTitle}</p>
              <div className="flex items-center gap-2">
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onClear} disabled={!hasItems}>
                  清空
                </button>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={() => setDrawerOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="flex-1 space-y-5 overflow-auto p-3">
              {!hasItems && <p className="text-xs text-slate-400">当前没有需要关注的通知。</p>}

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-200">当前需关注</p>
                  <span className="text-[11px] text-slate-500">{stateItems.length}</span>
                </div>
                {stateItems.length === 0 ? (
                  <p className="text-xs text-slate-400">当前没有活跃风险或异常状态。</p>
                ) : (
                  stateItems.map(renderItem)
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-200">最近记录</p>
                  <span className="text-[11px] text-slate-500">{historyItems.length}</span>
                </div>
                {historyItems.length === 0 ? (
                  <p className="text-xs text-slate-400">暂无最近记录。</p>
                ) : (
                  historyItems.map(renderItem)
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
