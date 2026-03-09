import { describe, expect, it } from "vitest";
import { NOTICE_ADVICE, buildNoticeDetail, buildJobLabel } from "./notificationCopy";

describe("notificationCopy", () => {
  it("uses only the approved advice lexicon", () => {
    expect(Object.values(NOTICE_ADVICE)).toEqual([
      "建议复核参数",
      "建议稍后重试",
      "建议查看结果",
      "建议关注运行状态"
    ]);
  });

  it("builds three-part notice details", () => {
    expect(buildNoticeDetail("回测任务 abcd1234", "已完成", NOTICE_ADVICE.viewResults)).toBe(
      "回测任务 abcd1234 · 已完成 · 建议查看结果"
    );
  });

  it("formats job labels with short job id", () => {
    expect(buildJobLabel("优化任务", "job-abcdef123456")).toBe("优化任务 job-abcd");
  });
});
