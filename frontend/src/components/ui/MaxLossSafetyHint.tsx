interface Props {
  estimatedLoss: number;
  limit: number | null | undefined;
  anchorPrice?: number | null;
  anchorTime?: string | null;
  anchorLoading?: boolean;
  anchorLabel?: string;
  className?: string;
}

function safeNumber(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, num);
}

function fmt(value: number): string {
  return safeNumber(value).toFixed(2);
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function formatAnchorTime(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const ts = new Date(value);
  if (!Number.isFinite(ts.getTime())) {
    return "";
  }
  return ts.toLocaleString();
}

type HintTone = "neutral" | "safe" | "caution" | "danger";

function toneOf(estimatedLoss: number, limit: number | null | undefined): HintTone {
  const safeLimit = Number(limit);
  if (!Number.isFinite(safeLimit) || safeLimit <= 0) {
    return "neutral";
  }
  const ratio = estimatedLoss / safeLimit;
  if (ratio <= 0.7) {
    return "safe";
  }
  if (ratio <= 1) {
    return "caution";
  }
  return "danger";
}

function toneClasses(tone: HintTone): { chip: string; fill: string; border: string; text: string; label: string } {
  if (tone === "safe") {
    return {
      chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35",
      fill: "bg-emerald-400",
      border: "border-emerald-500/30",
      text: "text-emerald-200",
      label: "安全区"
    };
  }
  if (tone === "caution") {
    return {
      chip: "bg-amber-500/15 text-amber-300 border-amber-500/35",
      fill: "bg-amber-400",
      border: "border-amber-500/30",
      text: "text-amber-200",
      label: "临界区"
    };
  }
  if (tone === "danger") {
    return {
      chip: "bg-rose-500/15 text-rose-300 border-rose-500/35",
      fill: "bg-rose-400",
      border: "border-rose-500/30",
      text: "text-rose-200",
      label: "超限"
    };
  }
  return {
    chip: "bg-slate-500/12 text-slate-200 border-slate-500/30",
    fill: "bg-slate-400",
    border: "border-slate-600/50",
    text: "text-slate-300",
    label: "未设上限"
  };
}

export default function MaxLossSafetyHint({
  estimatedLoss,
  limit,
  anchorPrice = null,
  anchorTime = null,
  anchorLoading = false,
  anchorLabel = "第一根K线收盘价",
  className = ""
}: Props) {
  const safeEstimated = safeNumber(estimatedLoss);
  const safeLimit = Number(limit);
  const hasLimit = Number.isFinite(safeLimit) && safeLimit > 0;
  const ratio = hasLimit ? safeEstimated / safeLimit : 0;
  const fillPct = hasLimit ? Math.max(4, Math.min(100, ratio * 100)) : 8;
  const tone = toneOf(safeEstimated, limit);
  const toneClass = toneClasses(tone);

  const anchorTimeText = formatAnchorTime(anchorTime);

  return (
    <div className={`mt-1.5 rounded-md border px-2 py-1.5 text-[11px] ${toneClass.border} ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className={`truncate ${toneClass.text}`}>预计止损亏损 {fmt(safeEstimated)} USDT</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 border ${toneClass.chip}`}>{toneClass.label}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/50">
        <div className={`h-full rounded-full transition-all ${toneClass.fill}`} style={{ width: `${fillPct}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        {hasLimit ? `上限 ${fmt(safeLimit)} USDT · 占比 ${percent(ratio)}` : "未设置最大亏损上限，当前仅显示估算值"}
      </p>
      <p className="mt-0.5 text-[10px] text-slate-500">
        {anchorLoading
          ? "锚定价获取中..."
          : Number.isFinite(anchorPrice)
          ? `锚定价 ${fmt(Number(anchorPrice))}（${anchorLabel}）${anchorTimeText ? ` · ${anchorTimeText}` : ""}`
          : "锚定价未获取，暂用当前参数估算"}
      </p>
    </div>
  );
}
