import type { JobTransportMode } from "../../../types";
import type { OptimizationConfig, OptimizationStatusResponse } from "../../../lib/api-schema";
import OptimizationControls from "../../OptimizationControls";
import StateBlock from "../../ui/StateBlock";

interface Props {
  config: OptimizationConfig;
  onChangeConfig: (next: OptimizationConfig) => void;
  optimizationError: string | null;
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationEtaSeconds: number | null;
  optimizationTransportMode: JobTransportMode;
  onCancelOptimization: () => void;
  showControls?: boolean;
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "-";
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function shortJobId(jobId: string): string {
  const value = (jobId || "").trim();
  if (value.length <= 12) {
    return value || "-";
  }
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

export default function OptimizationRuntimeWorkspace({
  config,
  onChangeConfig,
  optimizationError,
  optimizationStatus,
  optimizationEtaSeconds,
  optimizationTransportMode,
  onCancelOptimization,
  showControls = true
}: Props) {
  const scrollToParameterPanel = () => {
    const parameterPanel = document.querySelector("aside");
    if (!parameterPanel) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    parameterPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const parameterAction = (
    <button
      type="button"
      className="ui-btn ui-btn-secondary ui-btn-xs"
      onClick={scrollToParameterPanel}
    >
      去参数区
    </button>
  );

  const progressValue = optimizationStatus
    ? Math.min(100, Math.max(0, Number(optimizationStatus.job.progress) || 0))
    : 0;
  const showCancel =
    optimizationStatus && (optimizationStatus.job.status === "running" || optimizationStatus.job.status === "pending");
  const statusText = optimizationStatus ? optimizationStatus.job.status : "idle";

  return (
    <>
      {optimizationTransportMode === "polling" && (
        <div className="card mb-2 border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          实时流暂不可用，已自动降级为轮询跟踪。
        </div>
      )}
      <div className="card p-2.5 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">运行状态</p>
          <div className="flex items-center gap-2">
            <span className="mono text-base font-bold leading-none text-cyan-300 sm:text-xl">{fmt(progressValue, 2)}%</span>
            {showCancel && (
              <button
                className="ui-btn ui-btn-secondary ui-btn-xs"
                type="button"
                onClick={onCancelOptimization}
              >
                取消
              </button>
            )}
          </div>
        </div>

        <div className="mt-1">
          <div className="ui-progress-track h-2.5">
            <div className="ui-progress-fill" style={{ width: `${progressValue}%` }} />
          </div>
        </div>

        {optimizationStatus ? (
          <>
            <p className="mt-2 text-xs text-slate-400">
              状态 {statusText} · 进度 {fmt(progressValue, 2)}% · ETA {formatEta(optimizationEtaSeconds)} · 任务{" "}
              {shortJobId(optimizationStatus.job.job_id)}
            </p>
          </>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-400">先配置参数并开始优化。</p>
            {parameterAction}
          </div>
        )}
      </div>

      {showControls && (
        <OptimizationControls
          config={config}
          onChange={onChangeConfig}
        />
      )}

      {optimizationError && <StateBlock variant="error" title="优化错误" message={optimizationError} action={parameterAction} minHeight={100} />}
    </>
  );
}
