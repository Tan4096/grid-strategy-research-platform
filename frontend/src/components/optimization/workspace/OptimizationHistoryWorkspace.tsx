import { useMemo, useState } from "react";
import { OptimizationProgressResponse, OptimizationStatusResponse } from "../../../types";

interface Props {
  optimizationHistory: OptimizationProgressResponse[];
  optimizationHistoryLoading: boolean;
  onRefreshOptimizationHistory: () => void;
  onLoadOptimizationHistoryJob: (jobId: string) => void;
  onRestartOptimizationHistoryJob: (jobId: string) => void;
  onFetchOptimizationHistoryJobStatus: (jobId: string) => Promise<OptimizationStatusResponse>;
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

export default function OptimizationHistoryWorkspace({
  optimizationHistory,
  optimizationHistoryLoading,
  onRefreshOptimizationHistory,
  onLoadOptimizationHistoryJob,
  onRestartOptimizationHistoryJob,
  onFetchOptimizationHistoryJobStatus
}: Props) {
  const [compareJobIds, setCompareJobIds] = useState<string[]>([]);
  const [compareStatuses, setCompareStatuses] = useState<OptimizationStatusResponse[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  const selectedCompareRows = useMemo(
    () => optimizationHistory.filter((item) => compareJobIds.includes(item.job.job_id)),
    [compareJobIds, optimizationHistory]
  );

  const toggleCompareJob = (jobId: string) => {
    setCompareStatuses([]);
    setCompareJobIds((prev) => {
      if (prev.includes(jobId)) {
        return prev.filter((id) => id !== jobId);
      }
      if (prev.length >= 2) {
        return [prev[1], jobId];
      }
      return [...prev, jobId];
    });
  };

  const loadComparison = async () => {
    if (compareJobIds.length < 2) {
      return;
    }
    setCompareLoading(true);
    try {
      const [left, right] = await Promise.all([
        onFetchOptimizationHistoryJobStatus(compareJobIds[0]),
        onFetchOptimizationHistoryJobStatus(compareJobIds[1])
      ]);
      setCompareStatuses([left, right]);
    } finally {
      setCompareLoading(false);
    }
  };

  return (
    <>
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-100">优化历史</p>
            <p className="text-xs text-slate-400">查看历史任务、重启任务、选择两条做对比</p>
          </div>
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200"
            onClick={onRefreshOptimizationHistory}
            disabled={optimizationHistoryLoading}
          >
            {optimizationHistoryLoading ? "刷新中..." : "刷新"}
          </button>
        </div>

        <div className="max-h-[320px] overflow-auto rounded border border-slate-700/60">
          <table className="w-full min-w-[760px] border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
              <tr>
                <th className="px-2 py-2 text-left">对比</th>
                <th className="px-2 py-2 text-left">任务ID</th>
                <th className="px-2 py-2 text-left">状态</th>
                <th className="px-2 py-2 text-left">创建时间</th>
                <th className="px-2 py-2 text-right">进度%</th>
                <th className="px-2 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {optimizationHistory.map((item) => (
                <tr key={item.job.job_id} className="border-t border-slate-700/50 text-slate-100">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={compareJobIds.includes(item.job.job_id)}
                      onChange={() => toggleCompareJob(item.job.job_id)}
                    />
                  </td>
                  <td className="mono px-2 py-2">{item.job.job_id}</td>
                  <td className="px-2 py-2">{item.job.status}</td>
                  <td className="px-2 py-2">{new Date(item.job.created_at).toLocaleString()}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(item.job.progress, 1)}</td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-100"
                        onClick={() => onLoadOptimizationHistoryJob(item.job.job_id)}
                      >
                        查看
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-600 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-100"
                        onClick={() => onRestartOptimizationHistoryJob(item.job.job_id)}
                      >
                        重启
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-50"
            disabled={compareJobIds.length < 2 || compareLoading}
            onClick={loadComparison}
          >
            {compareLoading ? "对比中..." : "对比选中任务"}
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
            disabled={!compareJobIds.length}
            onClick={() => {
              setCompareJobIds([]);
              setCompareStatuses([]);
            }}
          >
            清空
          </button>
          <p className="text-xs text-slate-400">
            已选: {selectedCompareRows.map((item) => item.job.job_id.slice(0, 8)).join(" / ") || "-"}
          </p>
        </div>
      </div>

      {compareStatuses.length === 2 && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {compareStatuses.map((status) => {
            const row = status.best_row;
            return (
              <div key={status.job.job_id} className="card p-3 text-xs text-slate-200">
                <p className="font-semibold text-slate-100">任务 {status.job.job_id.slice(0, 8)}</p>
                {row ? (
                  <>
                    <p className="mt-1">
                      杠杆 {fmt(row.leverage, 2)}x · 网格 {row.grids} · LOWER {fmt(row.lower_price, 2)} · UPPER {fmt(row.upper_price, 2)}
                    </p>
                    <p className="mt-1">收益 {fmt(row.total_return_usdt, 2)} · 回撤 {fmt(row.max_drawdown_pct, 2)}% · 稳健评分 {fmt(row.robust_score, 4)}</p>
                  </>
                ) : (
                  <p className="mt-1 text-slate-400">该任务暂无最优组合</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
