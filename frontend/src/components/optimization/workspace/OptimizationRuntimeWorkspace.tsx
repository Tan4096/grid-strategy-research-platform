import { OptimizationConfig, OptimizationStatusResponse } from "../../../types";
import OptimizationControls from "../../OptimizationControls";
import StateBlock from "../../ui/StateBlock";

interface Props {
  config: OptimizationConfig;
  onChangeConfig: (next: OptimizationConfig) => void;
  optimizationError: string | null;
  optimizationStatus: OptimizationStatusResponse | null;
  optimizationEtaSeconds: number | null;
  onCancelOptimization: () => void;
  onExportOptimization: () => void;
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

export default function OptimizationRuntimeWorkspace({
  config,
  onChangeConfig,
  optimizationError,
  optimizationStatus,
  optimizationEtaSeconds,
  onCancelOptimization,
  onExportOptimization
}: Props) {
  return (
    <>
      <div className="card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-100">运行面板</p>
            <p className="text-xs text-slate-400">
              {optimizationStatus
                ? `进度 ${fmt(optimizationStatus.job.progress, 1)}% · ETA ${formatEta(optimizationEtaSeconds)}`
                : "配置参数后可在左侧直接开始参数优化"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {optimizationStatus && (optimizationStatus.job.status === "running" || optimizationStatus.job.status === "pending") && (
              <button
                className="rounded border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
                type="button"
                onClick={onCancelOptimization}
              >
                取消
              </button>
            )}
            {optimizationStatus && (
              <button
                className="rounded border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 disabled:opacity-60"
                type="button"
                disabled={optimizationStatus.job.status !== "completed"}
                onClick={onExportOptimization}
              >
                导出
              </button>
            )}
          </div>
        </div>

        {optimizationStatus ? (
          <>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-200">任务ID: {optimizationStatus.job.job_id}</p>
                <p className="text-xs text-slate-400">
                  进度 {fmt(optimizationStatus.job.progress, 1)}% · ETA {formatEta(optimizationEtaSeconds)} · 组合 {optimizationStatus.job.total_combinations}
                </p>
                <p className="text-xs text-slate-500">
                  完成 {optimizationStatus.job.trials_completed} · 剪枝 {optimizationStatus.job.trials_pruned} · 剪枝率{" "}
                  {fmt((optimizationStatus.job.pruning_ratio ?? 0) * 100, 1)}%
                </p>
                {optimizationStatus.job.message && <p className="mt-1 text-xs text-slate-500">{optimizationStatus.job.message}</p>}
              </div>
            </div>

            <div className="mt-2 h-2 rounded bg-slate-800">
              <div
                className="h-2 rounded bg-slate-300 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, optimizationStatus.job.progress))}%` }}
              />
            </div>

            {(optimizationStatus.train_window || optimizationStatus.validation_window) && (
              <details className="mt-2 rounded border border-slate-700/60 bg-slate-900/30 p-2 text-xs text-slate-300">
                <summary className="cursor-pointer font-semibold text-slate-200">训练/验证区间</summary>
                <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2">
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
        ) : (
          <p className="mt-2 text-xs text-slate-400">先配置参数并开始优化，任务状态会在这里实时更新。</p>
        )}
      </div>

      <OptimizationControls
        config={config}
        onChange={onChangeConfig}
      />

      {optimizationError && <StateBlock variant="error" title="优化错误" message={optimizationError} minHeight={100} />}
    </>
  );
}
