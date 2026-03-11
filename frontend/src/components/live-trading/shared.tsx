import type { LiveDiagnostic, LiveLedgerEntry, LiveSnapshotResponse } from "../../lib/api-schema";
import { buildGridLedgerGroups } from "./ledgerGrouping";
import type {
  LiveMonitoringIntegrityLevel,
  LiveMonitoringRiskLevel
} from "../../lib/liveMonitoringUx";

export type LedgerView = "summary" | "daily" | "ledger";
export type LedgerKindFilter = "all" | LiveLedgerEntry["kind"];
export type LedgerSideFilter = "all" | "buy" | "sell";
export type LedgerMakerFilter = "all" | "maker" | "taker";
export type LedgerTimeFilter = "all" | "24h" | "7d" | "30d";
export type LedgerPreset = "trading" | "all" | "trades" | "fees" | "funding";

export function fmt(value: number | null | undefined, digits = 2): string {
  return value !== null && value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

export function pickPositiveValue(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value !== null && value !== undefined && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

export function pct(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "--";
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "--" : parsed.toLocaleString();
}

export function formatDurationSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return "--";
  }
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}m ${remain}s`;
}

export function resolveBaseAssetSymbol(symbol: string, exchangeSymbol: string): string {
  const normalizedExchangeSymbol = exchangeSymbol.trim().toUpperCase();
  if (normalizedExchangeSymbol.includes("-")) {
    const [baseSymbol] = normalizedExchangeSymbol.split("-");
    if (baseSymbol) {
      return baseSymbol;
    }
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  const quoteSuffixes = ["USDT", "USDC", "USD", "BUSD", "FDUSD", "BTC", "ETH"];
  const matchedQuote = quoteSuffixes.find(
    (quoteSymbol) => normalizedSymbol.endsWith(quoteSymbol) && normalizedSymbol.length > quoteSymbol.length
  );
  return matchedQuote ? normalizedSymbol.slice(0, -matchedQuote.length) : normalizedSymbol;
}

export function fmtAssetAmount(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

export function resolveSingleGridBaseAmount(snapshot: LiveSnapshotResponse): number | null {
  const contractSizeBase = snapshot.market_params?.contract_size_base;
  const singleAmountContracts = snapshot.robot.single_amount;
  if (
    contractSizeBase === null ||
    contractSizeBase === undefined ||
    !Number.isFinite(contractSizeBase) ||
    contractSizeBase <= 0 ||
    singleAmountContracts === null ||
    singleAmountContracts === undefined ||
    !Number.isFinite(singleAmountContracts) ||
    singleAmountContracts <= 0
  ) {
    return null;
  }
  return singleAmountContracts * contractSizeBase;
}

function resolveHeldGridCountMeta(snapshot: LiveSnapshotResponse): {
  value: number | null;
  source: "empty" | "orders" | "fills" | "estimated" | "unknown";
} {
  const positionQuantity = snapshot.position.quantity;
  if (positionQuantity !== null && positionQuantity !== undefined && Number.isFinite(positionQuantity)) {
    if (Math.abs(positionQuantity) <= 1e-9) {
      return { value: 0, source: "empty" };
    }
  }

  const direction =
    snapshot.robot.direction === "long" || snapshot.robot.direction === "short"
      ? snapshot.robot.direction
      : snapshot.inferred_grid.side === "long" || snapshot.inferred_grid.side === "short"
        ? snapshot.inferred_grid.side
        : snapshot.position.side === "short"
          ? "short"
          : snapshot.position.side === "long"
            ? "long"
            : null;

  if (direction && Array.isArray(snapshot.open_orders) && snapshot.open_orders.length > 0) {
    const heldOrderSide = direction === "short" ? "buy" : "sell";
    const heldOrderCount = snapshot.open_orders.filter((order) => order.side === heldOrderSide).length;
    if (heldOrderCount > 0) {
      return { value: heldOrderCount, source: "orders" };
    }
  }

  if (Array.isArray(snapshot.fills) && snapshot.fills.length > 0) {
    const grouped = buildGridLedgerGroups(snapshot);
    if (grouped.openGroups.length > 0) {
      return { value: grouped.openGroups.length, source: "fills" };
    }
    if (snapshot.completeness.fills_complete) {
      return { value: grouped.estimatedBaseLots, source: "fills" };
    }
  }

  const singleGridBaseAmount = resolveSingleGridBaseAmount(snapshot);
  if (singleGridBaseAmount === null || singleGridBaseAmount <= 0) {
    return { value: null, source: "unknown" };
  }
  return { value: Math.max(0, Math.round(positionQuantity / singleGridBaseAmount)), source: "estimated" };
}

export function resolveHeldGridCount(snapshot: LiveSnapshotResponse): number | null {
  return resolveHeldGridCountMeta(snapshot).value;
}

export function resolveHeldGridCountSource(snapshot: LiveSnapshotResponse): "empty" | "orders" | "fills" | "estimated" | "unknown" {
  return resolveHeldGridCountMeta(snapshot).source;
}

export function fmtGridCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return `${Math.max(0, Math.round(value))} 格`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function exportLedgerCsv(entries: LiveLedgerEntry[]): void {
  const lines = ["timestamp,kind,amount,pnl,fee,currency,side,order_id,trade_id,is_maker,note"];
  entries.forEach((entry) => {
    lines.push(
      [
        csvEscape(entry.timestamp),
        csvEscape(entry.kind),
        csvEscape(entry.amount),
        csvEscape(entry.pnl),
        csvEscape(entry.fee),
        csvEscape(entry.currency),
        csvEscape(entry.side),
        csvEscape(entry.order_id),
        csvEscape(entry.trade_id),
        csvEscape(entry.is_maker),
        csvEscape(entry.note)
      ].join(",")
    );
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `live-ledger-${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function MetricCard({
  label,
  value,
  accent = "text-slate-100",
  meta,
  detail
}: {
  label: string;
  value: string;
  accent?: string;
  meta?: string;
  detail?: string;
}) {
  return (
    <div className="card-sub flex min-h-[96px] flex-col justify-between border border-slate-700/60 bg-slate-900/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs uppercase tracking-wide text-slate-400">
        <span>{label}</span>
        {meta ? <span className="normal-case tracking-normal text-[11px] text-slate-500">{meta}</span> : null}
      </div>
      <div className={`mt-2 text-lg font-semibold ${accent}`}>{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-400">{detail}</div> : null}
    </div>
  );
}

export function DenseStat({
  label,
  value,
  accent = "text-slate-100",
  emphasis = false,
  detail,
  tone = "neutral",
  uniformHeight = false
}: {
  label: string;
  value: string;
  accent?: string;
  emphasis?: boolean;
  detail?: string;
  tone?: "neutral" | "green" | "amber" | "red";
  uniformHeight?: boolean;
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-400/35 bg-emerald-500/10"
      : tone === "amber"
        ? "border-amber-400/35 bg-amber-500/10"
        : tone === "red"
          ? "border-rose-400/35 bg-rose-500/10"
          : "border-slate-700/60 bg-slate-950/30";
  return (
    <div className={`rounded border ${uniformHeight ? "flex min-h-[68px] h-full flex-col px-3 py-1.5" : "px-3 py-2"} ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`${emphasis ? "mt-1.5 text-xl" : "mt-1 text-sm"} font-semibold ${accent}`}>{value}</div>
      {detail ? <div className="mt-1 text-[11px] text-slate-500">{detail}</div> : null}
    </div>
  );
}

function statusTone(status: "failed" | "partial" | "ready"): string {
  if (status === "failed") {
    return "border-rose-400/35 bg-rose-500/10 text-rose-200";
  }
  if (status === "partial") {
    return "border-amber-400/35 bg-amber-500/10 text-amber-200";
  }
  return "border-emerald-400/35 bg-emerald-500/10 text-emerald-200";
}

export function StatusBadge({
  label,
  value,
  tone,
  accentTheme = false,
  compact = false
}: {
  label: string;
  value: string;
  tone: "failed" | "partial" | "ready";
  accentTheme?: boolean;
  compact?: boolean;
}) {
  const className = accentTheme
    ? "card-sub border-[color:rgba(var(--accent-rgb),0.5)] bg-[color:rgba(var(--accent-rgb),0.16)] text-slate-100"
    : statusTone(tone);
  return (
    <div className={`rounded border ${compact ? "px-2 py-1" : "px-2 py-1.5"} ${className}`}>
      <div className={`uppercase tracking-wide opacity-75 ${compact ? "text-[10px]" : "text-[11px]"}`}>{label}</div>
      <div className={`${compact ? "mt-0.5 text-xs" : "mt-1 text-sm"} font-semibold`}>{value}</div>
    </div>
  );
}

function toneBadgeClass(tone: "green" | "red" | "gray" | "amber"): string {
  if (tone === "green") {
    return "border-emerald-400/35 bg-emerald-500/10 text-emerald-200";
  }
  if (tone === "red") {
    return "border-rose-400/35 bg-rose-500/10 text-rose-200";
  }
  if (tone === "gray") {
    return "border-slate-600/70 bg-slate-900/40 text-slate-300";
  }
  return "border-amber-400/35 bg-amber-500/10 text-amber-200";
}

export function RobotBadge({
  label,
  tone
}: {
  label: string;
  tone: "green" | "red" | "gray" | "amber";
}) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneBadgeClass(tone)}`}>
      {label}
    </span>
  );
}

export function riskToneClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "text-slate-300";
  }
  if (value < 2) {
    return "text-rose-300";
  }
  if (value < 5) {
    return "text-amber-200";
  }
  return "text-emerald-300";
}

export function riskToneKey(value: number | null): "neutral" | "green" | "amber" | "red" {
  if (value === null || !Number.isFinite(value)) {
    return "neutral";
  }
  if (value < 2) {
    return "red";
  }
  if (value < 5) {
    return "amber";
  }
  return "green";
}

export function buildMonitoringGapSummary(snapshot: LiveSnapshotResponse): string {
  const parts: string[] = [];
  if (snapshot.monitoring.stale) {
    parts.push("当前显示最近一次成功数据");
  }
  if (snapshot.monitoring.fills_capped) {
    parts.push("成交明细达到分页上限，较早记录未纳入");
  }
  if (snapshot.diagnostics.some((item) => item.code === "LIVE_BOT_ORDERS_UNAVAILABLE")) {
    parts.push("活动挂单暂不可用");
  }
  if (snapshot.diagnostics.some((item) => item.code === "funding_not_available")) {
    parts.push("资金费暂不可用");
  }
  if (parts.length === 0) {
    return "当前监测数据完整，可用于持续观察。";
  }
  return `${parts.join("；")}。`;
}

export function robotStateLabel(value: string | null | undefined): {
  label: string;
  tone: "green" | "red" | "gray" | "amber";
} {
  const raw = (value || "").trim().toLowerCase();
  if (raw === "running") {
    return { label: "运行中", tone: "green" };
  }
  if (raw === "stopped") {
    return { label: "已停止", tone: "gray" };
  }
  if (raw === "paused" || raw === "pause") {
    return { label: "已暂停", tone: "amber" };
  }
  if (raw === "stop_pending" || raw === "stopping") {
    return { label: "停止中", tone: "amber" };
  }
  return { label: value || "未知状态", tone: "amber" };
}

export function robotDirectionLabel(value: string | null | undefined): {
  label: string;
  tone: "green" | "red" | "gray" | "amber";
} {
  const raw = (value || "").trim().toLowerCase();
  if (raw === "long") {
    return { label: "做多", tone: "green" };
  }
  if (raw === "short") {
    return { label: "做空", tone: "red" };
  }
  if (raw === "flat") {
    return { label: "空仓", tone: "gray" };
  }
  return { label: value || "方向未知", tone: "amber" };
}

export function robotRunTypeLabel(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) {
    return "--";
  }
  if (raw === "1") {
    return "手动启动";
  }
  if (raw === "2") {
    return "条件启动";
  }
  if (raw === "3") {
    return "循环运行";
  }
  return raw;
}

export function riskLevelMeta(level: LiveMonitoringRiskLevel): {
  label: string;
  tone: "failed" | "partial" | "ready";
  accent: string;
} {
  if (level === "danger") {
    return { label: "危险", tone: "failed", accent: "text-rose-300" };
  }
  if (level === "watch") {
    return { label: "关注", tone: "partial", accent: "text-amber-200" };
  }
  return { label: "正常", tone: "ready", accent: "text-emerald-300" };
}

export function integrityLevelMeta(level: LiveMonitoringIntegrityLevel): {
  label: string;
  tone: "failed" | "partial" | "ready";
  accent: string;
} {
  if (level === "low") {
    return { label: "低", tone: "failed", accent: "text-rose-300" };
  }
  if (level === "medium") {
    return { label: "中", tone: "partial", accent: "text-amber-200" };
  }
  return { label: "高", tone: "ready", accent: "text-emerald-300" };
}

export function dataStatusMeta(stale: boolean, hasSyncIssue: boolean): {
  label: string;
  tone: "failed" | "partial" | "ready";
  accent: string;
  detail: string;
} {
  if (hasSyncIssue) {
    return { label: "异常", tone: "failed", accent: "text-rose-300", detail: "当前显示最近一次成功数据" };
  }
  if (stale) {
    return { label: "延迟", tone: "partial", accent: "text-amber-200", detail: "当前显示最近一次成功数据" };
  }
  return { label: "正常", tone: "ready", accent: "text-emerald-300", detail: "数据同步正常" };
}

export function robotBadgeToneToStatus(
  tone: "green" | "red" | "gray" | "amber"
): "failed" | "partial" | "ready" {
  if (tone === "green") {
    return "ready";
  }
  if (tone === "red") {
    return "failed";
  }
  return "partial";
}

export function ActionHintButton({
  action,
  label,
  onRefresh,
  onApplyParameters,
  onApplyEnvironment,
  onApplySuggestedWindow,
  onOpenLedger
}: {
  action: string | null | undefined;
  label?: string | null;
  onRefresh: () => void;
  onApplyParameters: () => void;
  onApplyEnvironment: () => void;
  onApplySuggestedWindow: (days: number) => void;
  onOpenLedger: () => void;
}) {
  if (action === "retry_sync") {
    return (
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onRefresh}>
        {label ?? "重新连接"}
      </button>
    );
  }
  if (action === "shrink_time_window") {
    const days = label?.includes("90") ? 90 : 30;
    return (
      <button
        type="button"
        className="ui-btn ui-btn-secondary ui-btn-xs"
        onClick={() => onApplySuggestedWindow(days)}
      >
        {label ?? "缩短监测窗口"}
      </button>
    );
  }
  if (action === "review_time_window") {
    return (
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onApplyEnvironment}>
        {label ?? "回填起点"}
      </button>
    );
  }
  if (action === "review_ledger") {
    return (
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onOpenLedger}>
        {label ?? "查看逐笔账单"}
      </button>
    );
  }
  if (action === "apply_parameters") {
    return (
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-xs" onClick={onApplyParameters}>
        {label ?? "回填到左侧参数"}
      </button>
    );
  }
  return null;
}

export function groupDiagnostics(items: LiveDiagnostic[]): Record<LiveDiagnostic["level"], LiveDiagnostic[]> {
  return {
    error: items.filter((item) => item.level === "error"),
    warning: items.filter((item) => item.level === "warning"),
    info: items.filter((item) => item.level === "info")
  };
}
