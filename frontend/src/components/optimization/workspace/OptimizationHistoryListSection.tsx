import type { OptimizationHistoryViewModel } from "../../../hooks/optimization/useOptimizationHistoryViewModel";

function fmt(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

interface Props {
  viewModel: OptimizationHistoryViewModel;
}

export default function OptimizationHistoryListSection({ viewModel }: Props) {
  const {
    optimizationHistoryLoading,
    optimizationHistoryHasMore,
    onRefreshOptimizationHistory,
    onLoadMoreOptimizationHistory,
    onLoadOptimizationHistoryJob,
    onRestartOptimizationHistoryJob,
    visibleHistory,
    isMobile,
    selectedByJobId,
    toggleSelectJob,
    allJobIds,
    allSelected,
    toggleSelectAll,
    undoLastSelection,
    undoSelectionSnapshot,
    clearingHistory,
    requestClearHistory,
    selectedCount
  } = viewModel;

  return (
    <div className="card p-4" data-tour-id="optimization-history-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-100">优化历史</p>
          <p className="text-xs text-slate-400">查看历史任务、重启任务、批量选择任务</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-xs"
            onClick={onRefreshOptimizationHistory}
            disabled={optimizationHistoryLoading}
          >
            {optimizationHistoryLoading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span className="text-slate-500">
          当前已加载 {visibleHistory.length} 条
          {optimizationHistoryHasMore ? "，可继续加载更多" : "，已加载全部"}
        </span>
      </div>

      {isMobile ? (
        <div className="mobile-two-col-grid max-h-[56vh] grid grid-cols-1 gap-2 overflow-auto pr-1">
          {visibleHistory.map((item, index) => {
            const selected = Boolean(selectedByJobId[item.job.job_id]);
            return (
              <div
                key={`${item.job.job_id}-${item.job.created_at}-${index}`}
                data-history-job-id={item.job.job_id}
                className="card-sub space-y-2 p-2.5 text-xs text-slate-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelectJob(item.job.job_id)}
                    />
                    <span className="text-slate-300">选择</span>
                  </label>
                  <span className="rounded border border-slate-700/70 px-1.5 py-0.5 text-[11px] text-slate-300">
                    {item.job.status}
                  </span>
                </div>
                <p className="mono break-all text-[11px] text-slate-300">{item.job.job_id}</p>
                <p className="text-[11px] text-slate-400">
                  创建时间：{new Date(item.job.created_at).toLocaleString()}
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-300">
                  <span>进度</span>
                  <span className="mono">{fmt(item.job.progress, 1)}%</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-xs flex-1"
                    onClick={() => onLoadOptimizationHistoryJob(item.job.job_id)}
                  >
                    查看
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-xs flex-1"
                    onClick={() => onRestartOptimizationHistoryJob(item.job.job_id)}
                  >
                    重启
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="max-h-[320px] overflow-auto rounded border border-slate-700/60">
          <p className="px-2 pt-2 text-[11px] text-slate-400 sm:hidden">可左右滑动查看完整列</p>
          <table className="w-full min-w-[760px] border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
              <tr>
                <th className="px-2 py-2 text-left">选择</th>
                <th className="px-2 py-2 text-left">任务ID</th>
                <th className="px-2 py-2 text-left">状态</th>
                <th className="px-2 py-2 text-left">创建时间</th>
                <th className="px-2 py-2 text-right">进度%</th>
                <th className="px-2 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleHistory.map((item, index) => (
                <tr
                  key={`${item.job.job_id}-${item.job.created_at}-${index}`}
                  data-history-job-id={item.job.job_id}
                  className="border-t border-slate-700/50 text-slate-100"
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedByJobId[item.job.job_id])}
                      onChange={() => toggleSelectJob(item.job.job_id)}
                    />
                  </td>
                  <td className="mono px-2 py-2">{item.job.job_id}</td>
                  <td className="px-2 py-2">{item.job.status}</td>
                  <td className="px-2 py-2">{new Date(item.job.created_at).toLocaleString()}</td>
                  <td className="mono px-2 py-2 text-right">{fmt(item.job.progress, 1)}</td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary ui-btn-xs"
                        onClick={() => onLoadOptimizationHistoryJob(item.job.job_id)}
                      >
                        查看
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary ui-btn-xs"
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
      )}

      {optimizationHistoryHasMore && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
            onClick={onLoadMoreOptimizationHistory}
            disabled={optimizationHistoryLoading}
          >
            {optimizationHistoryLoading ? "加载中..." : "加载更多"}
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
          disabled={!allJobIds.length}
          onClick={toggleSelectAll}
        >
          {allSelected ? "取消全选（已加载范围）" : "全选已加载范围"}
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
          disabled={!undoSelectionSnapshot || clearingHistory}
          onClick={undoLastSelection}
        >
          撤销上次选择
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
          disabled={!selectedCount || clearingHistory}
          onClick={requestClearHistory}
          data-tour-id="clear-history-selected-button"
        >
          {clearingHistory ? "清空中..." : "清空已选"}
        </button>
        <p className="text-xs text-slate-400">
          已选（已加载范围）: {selectedCount}/{allJobIds.length}
        </p>
      </div>
    </div>
  );
}
