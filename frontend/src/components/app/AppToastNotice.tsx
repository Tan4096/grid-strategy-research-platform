import { useEffect } from "react";
import type { ToastNotice } from "../../hooks/app/useOperationFeedbackController";

interface AppToastNoticeProps {
  item: ToastNotice | null;
  isMobileViewport: boolean;
  onClose: (id: string) => void;
}

const AUTO_DISMISS_MS = 4000;

function toneClass(category: ToastNotice["category"]): string {
  if (category === "success") {
    return "border-emerald-400/70 bg-emerald-300 text-slate-950";
  }
  if (category === "warning") {
    return "border-amber-400/70 bg-amber-300 text-slate-950";
  }
  if (category === "error") {
    return "border-rose-400/70 bg-rose-300 text-slate-950";
  }
  return "border-[color:rgba(var(--accent-rgb),0.65)] bg-[color:rgba(var(--accent-rgb),1)] text-slate-950";
}

export default function AppToastNotice({
  item,
  isMobileViewport,
  onClose
}: AppToastNoticeProps) {
  useEffect(() => {
    if (!item) {
      return;
    }
    const timer = window.setTimeout(() => {
      onClose(item.id);
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [item, onClose]);

  if (!item) {
    return null;
  }

  const positionStyle = isMobileViewport
    ? {
        top: "calc(env(safe-area-inset-top) + 0.5rem)",
        left: "calc(env(safe-area-inset-left) + 0.5rem)",
        width: "min(360px, calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right) - 1rem))"
      }
    : undefined;

  return (
    <div
      className={`toast-notice fixed left-4 top-4 z-[5000] rounded-md border px-3 py-2 text-xs shadow-lg ${toneClass(item.category)} ${
        isMobileViewport ? "max-w-[calc(100vw-1rem)]" : "w-[360px]"
      }`}
      style={positionStyle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{item.title}</p>
          {item.detail && <p className="mt-0.5 line-clamp-2 opacity-90">{item.detail}</p>}
        </div>
        <button
          type="button"
          className="toast-close-btn ui-btn ui-btn-secondary ui-btn-xs h-6 min-h-0 px-2"
          aria-label="关闭通知"
          onClick={() => onClose(item.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
