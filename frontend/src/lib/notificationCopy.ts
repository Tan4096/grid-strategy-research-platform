export const NOTICE_ADVICE = {
  reviewParams: "建议复核参数",
  retryLater: "建议稍后重试",
  viewResults: "建议查看结果",
  watchRuntime: "建议关注运行状态"
} as const;

export type NoticeAdvice = (typeof NOTICE_ADVICE)[keyof typeof NOTICE_ADVICE];

export function buildNoticeDetail(subject: string, status: string, advice: NoticeAdvice | null | undefined): string {
  const normalize = (value: string) => value.trim().replace(/[。.!！？]+$/u, "");
  const parts = [subject, status, advice ?? ""].map((item) => normalize(item)).filter((item) => item.length > 0);
  return parts.join(" · ");
}

export function buildJobLabel(kind: string, jobId: string | null | undefined): string {
  const normalizedKind = kind.trim() || "任务";
  if (!jobId) {
    return normalizedKind;
  }
  return `${normalizedKind} ${jobId.slice(0, 8)}`;
}
