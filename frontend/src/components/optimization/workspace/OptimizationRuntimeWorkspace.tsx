import { JobTransportMode, OptimizationConfig, OptimizationStatusResponse } from "../../../types";
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
  compact?: boolean;
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

function formatTransportMode(mode: JobTransportMode): string {
  if (mode === "sse") {
    return "SSE 实时流";
  }
  if (mode === "polling") {
    return "轮询降级";
  }
  if (mode === "connecting") {
    return "连接中";
  }
  return "等待中";
}

export default function OptimizationRuntimeWorkspace({
  config,
  onChangeConfig,
  optimizationError,
  optimizationStatus,
  optimizationEtaSeconds,
  optimizationTransportMode,
  onCancelOptimization,
  showControls = true,
  compact = false
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
          <div>
            <p className="text-sm font-semibold text-slate-100">运行状态</p>
            <p className="text-xs text-slate-400">
              {compact ? "进度与 ETA 会持续刷新" : "任务状态与进度会在这里实时更新"}
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>进度</span>
            <span>{fmt(progressValue, 2)}%</span>
          </div>
          <div className="ui-progress-track mt-1">
            <div className="ui-progress-fill" style={{ width: `${progressValue}%` }} />
          </div>
        </div>

        {optimizationStatus ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
              <div className="card-sub px-2 py-1.5">状态: {statusText}</div>
              <div className="card-sub px-2 py-1.5">ETA: {formatEta(optimizationEtaSeconds)}</div>
              <div className="card-sub px-2 py-1.5">组合: {optimizationStatus.job.total_combinations}</div>
              <div className="card-sub px-2 py-1.5">
                步骤: {optimizationStatus.job.completed_steps}/{optimizationStatus.job.total_steps}
              </div>
            </div>

            {optimizationStatus.job.message && (
              <p className="mt-2 text-xs text-slate-400">{optimizationStatus.job.message}</p>
            )}

            {compact ? (
              <details className="mt-2 rounded border border-slate-700/60 bg-slate-900/30 p-2 text-xs text-slate-300">
                <summary className="cursor-pointer font-semibold text-slate-200">任务详情</summary>
                <div className="mt-2 space-y-1.5">
                  <p className="break-all text-xs text-slate-400">任务ID: {optimizationStatus.job.job_id}</p>
                  <p className="text-xs text-slate-400">传输: {formatTransportMode(optimizationTransportMode)}</p>
                  <p className="text-xs text-slate-400">
                    完成: {optimizationStatus.job.trials_completed} · 剪枝: {optimizationStatus.job.trials_pruned} · 剪枝率:{" "}
                    {fmt((optimizationStatus.job.pruning_ratio ?? 0) * 100, 1)}%
                  </p>
                </div>
                {(optimizationStatus.train_window || optimizationStatus.validation_window) && (
                  <div className="mobile-two-col-grid mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2">
                    {optimizationStatus.train_window && (
                      <div className="rounded border border-slate-700/60 p-2">
                        训练期: {new Date(optimizationStatus.train_window.start_time).toLocaleString()} ~{" "}
                        {new Date(optimizationStatus.train_window.end_time).toLocaleString()} ({optimizationStatus.train_window.candles} 根)
                      </div>
                    )}
                    {optimizationStatus.validation_window && (
                      <div className="rounded border border-slate-700/60 p-2">
                        验证期: {new Date(optimizationStatus.validation_window.start_time).toLocaleString()} ~{" "}
                        {new Date(optimizationStatus.validation_window.end_time).toLocaleString()} ({optimizationStatus.validation_window.candles} 根)
                      </div>
                    )}
                  </div>
                )}
              </details>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="break-all text-sm text-slate-200">任务ID: {optimizationStatus.job.job_id}</p>
                    <p className="text-xs text-slate-500">传输 {formatTransportMode(optimizationTransportMode)}</p>
                    <p className="text-xs text-slate-500">
                      完成 {optimizationStatus.job.trials_completed} · 剪枝 {optimizationStatus.job.trials_pruned} · 剪枝率{" "}
                      {fmt((optimizationStatus.job.pruning_ratio ?? 0) * 100, 1)}%
                    </p>
                  </div>
                </div>

                {(optimizationStatus.train_window || optimizationStatus.validation_window) && (
                  <details className="mt-2 rounded border border-slate-700/60 bg-slate-900/30 p-2 text-xs text-slate-300">
                    <summary className="cursor-pointer font-semibold text-slate-200">训练/验证区间</summary>
                    <div className="mobile-two-col-grid mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2">
                      {optimizationStatus.train_window && (
                        <div className="rounded border border-slate-700/60 p-2">
                          训练期: {new Date(optimizationStatus.train_window.start_time).toLocaleString()} ~{" "}
                          {new Date(optimizationStatus.train_window.end_time).toLocaleString()} ({optimizationStatus.train_window.candles} 根)
                        </div>
                      )}
                      {optimizationStatus.validation_window && (
                        <div className="rounded border border-slate-700/60 p-2">
                          验证期: {new Date(optimizationStatus.validation_window.start_time).toLocaleString()} ~{" "}
                          {new Date(optimizationStatus.validation_window.end_time).toLocaleString()} ({optimizationStatus.validation_window.candles} 根)
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </>
            )}
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
