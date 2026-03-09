import type { OptimizationHistoryViewModel } from "../../../hooks/optimization/useOptimizationHistoryViewModel";

interface Props {
  viewModel: OptimizationHistoryViewModel;
}

export default function OptimizationHistoryFailureSection({ viewModel }: Props) {
  const {
    clearFeedback,
    failureQueueItems,
    showFailureDetails,
    setShowFailureDetails,
    failureReasonFilter,
    setFailureReasonFilter,
    failureKeyword,
    setFailureKeyword,
    retryBatchSize,
    setRetryBatchSize,
    filteredFailureIds,
    copiedFailedList,
    copyFailureList,
    retryFilteredFailures,
    focusHistoryRows,
    showAdvancedRetry,
    setShowAdvancedRetry,
    fastRetryIds,
    refreshRetryIds,
    retryingFailed,
    clearingHistory,
    retryFastFailures,
    retryRefreshFailures,
    failureReasonGroups,
    failureReasonHint,
    retryFailuresByReason,
    retryingTag,
    completedRetryTag,
    retryButtonLabel,
    filteredFailureItems
  } = viewModel as OptimizationHistoryViewModel & {
    focusHistoryRows: (jobIds: string[]) => void;
  };

  if (!(clearFeedback && clearFeedback.failed > 0) && failureQueueItems.length === 0) {
    return null;
  }

  return (
    <section className="mt-3 rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-100">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold opacity-95">失败处理队列</p>
        <button
          type="button"
          className="ui-btn ui-btn-secondary ui-btn-xs"
          onClick={() => setShowFailureDetails((prev) => !prev)}
        >
          {showFailureDetails ? "收起失败队列" : "展开失败队列"}
        </button>
      </div>

      {showFailureDetails && (
        <div className="space-y-2 rounded border border-rose-500/30 bg-slate-950/40 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-rose-200">待处理失败：{failureQueueItems.length} 条</p>
            <label className="flex items-center gap-1 text-[11px] text-rose-200/90">
              每次重试
              <select
                className="ui-input h-7 w-20 !py-0 text-[11px]"
                value={retryBatchSize}
                onChange={(event) => setRetryBatchSize(Math.max(1, Number(event.target.value) || 1))}
              >
                {[20, 50, 100, 200].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              条
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <input
              className="ui-input h-8 text-[11px]"
              placeholder="筛选：任务ID / 原因码 / 原因描述"
              value={failureKeyword}
              onChange={(event) => setFailureKeyword(event.target.value)}
            />
            <select
              className="ui-input h-8 text-[11px]"
              value={failureReasonFilter}
              onChange={(event) => setFailureReasonFilter(event.target.value)}
            >
              <option value="ALL">全部原因</option>
              {failureReasonGroups.map((group) => (
                <option key={group.reasonCode} value={group.reasonCode}>
                  {group.reasonCode} ({group.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
              disabled={retryingFailed || clearingHistory || filteredFailureIds.length === 0}
              onClick={() => void retryFilteredFailures()}
            >
              {retryButtonLabel("filtered-retry", `重试失败项（最多 ${retryBatchSize} 条）`)}
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
              disabled={filteredFailureIds.length === 0}
              onClick={() => focusHistoryRows(filteredFailureIds)}
            >
              定位筛选项
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
              disabled={filteredFailureItems.length === 0}
              onClick={() => void copyFailureList()}
            >
              {copiedFailedList ? "已复制失败清单" : "复制失败清单"}
            </button>
          </div>

          <div className="rounded border border-rose-500/20 bg-rose-950/10 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-rose-100">高级重试策略</p>
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-xs"
                onClick={() => setShowAdvancedRetry((prev) => !prev)}
              >
                {showAdvancedRetry ? "收起" : "展开"}
              </button>
            </div>
            {showAdvancedRetry && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
                    disabled={retryingFailed || clearingHistory || fastRetryIds.length === 0}
                    onClick={() => void retryFastFailures()}
                  >
                    {retryButtonLabel("fast-retry", "仅重试可快速恢复")}
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
                    disabled={retryingFailed || clearingHistory || refreshRetryIds.length === 0}
                    onClick={() => void retryRefreshFailures()}
                  >
                    {retryButtonLabel("refresh-retry", "先刷新再重试运行中")}
                  </button>
                </div>
                {failureReasonGroups.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {failureReasonGroups.map((group) => {
                      const notRetryable =
                        group.reasonCode === "NOT_FOUND_OR_ALREADY_DELETED" ||
                        group.reasonCode === "NOT_FOUND_OR_NOT_DELETED";
                      const refreshBefore = group.reasonCode === "JOB_NOT_FINISHED";
                      return (
                        <div key={group.reasonCode} className="rounded border border-rose-500/20 bg-rose-950/10 p-2">
                          <p className="text-[11px] font-semibold text-rose-100">
                            {group.reasonCode} · {group.count} 条
                          </p>
                          <p className="mt-1 text-[11px] text-rose-200/85">{failureReasonHint(group.reasonCode)}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className="ui-btn ui-btn-secondary ui-btn-xs"
                              onClick={() => focusHistoryRows(group.items.map((item) => item.job_id))}
                            >
                              定位
                            </button>
                            <button
                              type="button"
                              className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
                              disabled={notRetryable || retryingFailed || clearingHistory}
                              onClick={() => void retryFailuresByReason(group.reasonCode)}
                            >
                              {notRetryable
                                ? "通常无需重试"
                                : retryingTag === `reason-${group.reasonCode}`
                                  ? "重试中..."
                                  : completedRetryTag === `reason-${group.reasonCode}`
                                    ? "已完成"
                                    : refreshBefore
                                      ? "刷新后重试"
                                      : "重试该原因"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {filteredFailureItems.length > 0 ? (
            <div className="max-h-36 overflow-auto rounded border border-rose-500/30 bg-slate-950/50 p-2 text-[11px]">
              {filteredFailureItems.slice(0, 200).map((item) => (
                <p key={item.job_id} className="mono break-all text-rose-200">
                  {item.job_id} · {item.reason_code} · {item.reason_message}
                </p>
              ))}
              {filteredFailureItems.length > 200 && (
                <p className="mt-1 text-rose-200/80">已截断显示前 200 条，请缩小筛选范围后继续定位。</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-rose-200/90">当前筛选条件下暂无失败项。</p>
          )}
        </div>
      )}
    </section>
  );
}
