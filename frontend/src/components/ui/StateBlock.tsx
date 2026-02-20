import type { ReactNode } from "react";

interface Props {
  variant: "loading" | "empty" | "error";
  title?: string;
  message: string;
  action?: ReactNode;
  minHeight?: number;
}

const STYLE_BY_VARIANT = {
  loading: {
    border: "border-slate-700/70",
    title: "text-slate-100",
    message: "text-slate-300"
  },
  empty: {
    border: "border-slate-700/70",
    title: "text-slate-100",
    message: "text-slate-300"
  },
  error: {
    border: "border-rose-500/40",
    title: "text-rose-300",
    message: "text-rose-200"
  }
} as const;

export default function StateBlock({
  variant,
  title,
  message,
  action,
  minHeight = 180
}: Props) {
  const style = STYLE_BY_VARIANT[variant];
  return (
    <div
      className={`card flex items-center justify-center p-4 ${style.border}`}
      style={{ minHeight }}
      role={variant === "error" ? "alert" : "status"}
    >
      <div className="max-w-xl text-center">
        {title && <p className={`text-sm font-semibold ${style.title}`}>{title}</p>}
        <p className={`mt-1 text-sm ${style.message}`}>{message}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
