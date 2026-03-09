import { ReactNode } from "react";
import { SweepRange } from "../../types";

export type SweepKey = "leverage" | "grids" | "band_width_pct" | "stop_loss_ratio_pct";
export type ComputeMode = "fast" | "balanced" | "eco";

export function labelClass() {
  return "mb-1 block text-xs uppercase tracking-wide text-slate-400";
}

export function inputClass() {
  return "ui-input ui-input-sm";
}

export function numberOrNull(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function sweepTitle(key: SweepKey): string {
  const mapping: Record<SweepKey, string> = {
    leverage: "杠杆",
    grids: "网格数",
    band_width_pct: "区间宽度(%)",
    stop_loss_ratio_pct: "止损比例(%)"
  };
  return mapping[key];
}

export function hardwareWorkers(): number {
  const hardware = typeof navigator !== "undefined" ? Number(navigator.hardwareConcurrency || 0) : 0;
  if (!Number.isFinite(hardware) || hardware <= 0) {
    return 4;
  }
  return Math.max(1, Math.min(64, Math.floor(hardware)));
}

export function modePreset(mode: ComputeMode): { max_workers: number; batch_size: number; chunk_size: number } {
  const workers = hardwareWorkers();
  if (mode === "fast") {
    return {
      max_workers: workers,
      batch_size: 800,
      chunk_size: 128
    };
  }
  if (mode === "eco") {
    return {
      max_workers: Math.max(1, Math.floor(workers * 0.35)),
      batch_size: 200,
      chunk_size: 32
    };
  }
  return {
    max_workers: Math.max(1, Math.floor(workers * 0.7)),
    batch_size: 400,
    chunk_size: 64
  };
}

export function activeMode(
  max_workers: number,
  batch_size: number,
  chunk_size: number
): ComputeMode | null {
  const fast = modePreset("fast");
  const balanced = modePreset("balanced");
  const eco = modePreset("eco");

  if (max_workers === fast.max_workers && batch_size === fast.batch_size && chunk_size === fast.chunk_size) {
    return "fast";
  }
  if (
    max_workers === balanced.max_workers &&
    batch_size === balanced.batch_size &&
    chunk_size === balanced.chunk_size
  ) {
    return "balanced";
  }
  if (max_workers === eco.max_workers && batch_size === eco.batch_size && chunk_size === eco.chunk_size) {
    return "eco";
  }
  return null;
}

export function estimateSweepCount(sweep: SweepRange): number {
  if (!sweep.enabled) {
    return 1;
  }
  if (sweep.values && sweep.values.length > 0) {
    return sweep.values.length;
  }
  if (sweep.start === null || sweep.end === null || sweep.step === null) {
    return 0;
  }
  if (sweep.step <= 0 || sweep.end < sweep.start) {
    return 0;
  }
  const count = Math.floor((sweep.end - sweep.start) / sweep.step + 1e-9) + 1;
  return Math.max(count, 0);
}

export function SectionCard({
  title,
  description,
  children,
  right,
  collapsible = false,
  open = true,
  onToggle,
  summary
}: {
  title: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  summary?: string;
}) {
  return (
    <section className="rounded-lg border border-slate-700/60 bg-slate-900/30 p-2.5">
      <div className={`flex flex-wrap items-start justify-between gap-2 ${open ? "mb-2" : ""}`}>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 text-left transition hover:text-slate-50"
            aria-expanded={open}
          >
            <span className={`text-[10px] text-slate-400 transition ${open ? "rotate-90" : ""}`}>▶</span>
            <div>
              <p className="text-sm font-semibold text-slate-200">{title}</p>
              {description && open ? <p className="mt-0.5 text-[11px] text-slate-400">{description}</p> : null}
            </div>
          </button>
        ) : (
          <div>
            <p className="text-sm font-semibold text-slate-200">{title}</p>
            {description ? <p className="mt-0.5 text-[11px] text-slate-400">{description}</p> : null}
          </div>
        )}
        {right}
      </div>
      {!open && summary ? (
        <p className="rounded border border-slate-700/50 bg-slate-950/40 px-2 py-1 text-xs text-slate-300">{summary}</p>
      ) : null}
      {open ? children : null}
    </section>
  );
}

export function SweepEditor({
  title,
  sweep,
  onChange,
  integerStep = false
}: {
  title: string;
  sweep: SweepRange;
  onChange: (next: SweepRange) => void;
  integerStep?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-700/60 bg-slate-900/40 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-200">{title}</p>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={sweep.enabled}
            onChange={(e) =>
              onChange({
                ...sweep,
                enabled: e.target.checked
              })
            }
          />
          启用
        </label>
      </div>

      <div className="mobile-two-col-grid grid grid-cols-1 gap-1.5 min-[380px]:grid-cols-3">
        <input
          className={inputClass()}
          type="number"
          step={integerStep ? 1 : 0.1}
          placeholder="开始"
          value={sweep.start ?? ""}
          onChange={(e) => onChange({ ...sweep, start: numberOrNull(e.target.value) })}
          disabled={!sweep.enabled}
        />
        <input
          className={inputClass()}
          type="number"
          step={integerStep ? 1 : 0.1}
          placeholder="结束"
          value={sweep.end ?? ""}
          onChange={(e) => onChange({ ...sweep, end: numberOrNull(e.target.value) })}
          disabled={!sweep.enabled}
        />
        <input
          className={`${inputClass()} mobile-two-col-span`}
          type="number"
          step={integerStep ? 1 : 0.1}
          placeholder="步长"
          value={sweep.step ?? ""}
          onChange={(e) => onChange({ ...sweep, step: numberOrNull(e.target.value) })}
          disabled={!sweep.enabled}
        />
      </div>
    </div>
  );
}
