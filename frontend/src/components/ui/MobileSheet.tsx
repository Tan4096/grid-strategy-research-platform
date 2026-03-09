import { ReactNode, useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  headerActions?: ReactNode;
  bodyClassName?: string;
  dataTourId?: string;
}

export default function MobileSheet({
  open,
  title,
  onClose,
  children,
  headerActions,
  bodyClassName = "",
  dataTourId
}: Props) {
  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <aside
        className="mobile-sheet-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-tour-id={dataTourId}
      >
        <div className="mobile-sheet-grabber" aria-hidden="true">
          <span />
        </div>
        <div className="mobile-sheet-header">
          <div>
            <p className="text-sm font-semibold text-slate-100">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div className={`mobile-sheet-body ${bodyClassName}`.trim()}>{children}</div>
      </aside>
    </div>
  );
}
