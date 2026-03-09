import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import OperationFeedbackCenter from "./OperationFeedbackCenter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountedNode {
  container: HTMLDivElement;
  rerender: (node: ReactNode) => void;
  unmount: () => void;
}

function mount(node: ReactNode): MountedNode {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const rerender = (nextNode: ReactNode) => {
    act(() => {
      root.render(nextNode);
    });
  };
  rerender(node);
  return {
    container,
    rerender,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}

describe("OperationFeedbackCenter", () => {
  it("supports external open mode without floating entry on mobile", () => {
    const dismiss = vi.fn();
    const dismissNotice = vi.fn();
    const clear = vi.fn();

    const mounted = mount(
      <OperationFeedbackCenter
        items={[]}
        latestItem={null}
        isMobileViewport
        mobileEntryMode="external"
        externalOpenSignal={0}
        onDismiss={dismiss}
        onDismissNotice={dismissNotice}
        onClear={clear}
      />
    );

    expect(mounted.container.textContent ?? "").not.toContain("通知中心");

    mounted.rerender(
      <OperationFeedbackCenter
        items={[]}
        latestItem={null}
        isMobileViewport
        mobileEntryMode="external"
        externalOpenSignal={1}
        onDismiss={dismiss}
        onDismissNotice={dismissNotice}
        onClear={clear}
      />
    );

    expect(mounted.container.textContent ?? "").toContain("通知中心 (0)");
    mounted.unmount();
  });
  it("groups state items and history items separately", () => {
    const dismiss = vi.fn();
    const dismissNotice = vi.fn();
    const clear = vi.fn();

    const items = [
      {
        id: "live-1",
        kind: "state",
        category: "warning",
        action: "live_attention_stale",
        status: "partial_failed",
        title: "监测延迟",
        detail: "BTCUSDT · 当前显示最近一次成功数据。",
        created_at: "2026-03-07T10:00:00+08:00",
        updated_at: "2026-03-07T10:01:00+08:00",
        source: "live_trading"
      },
      {
        id: "op-1",
        kind: "history",
        category: "success",
        action: "backtest_terminal",
        status: "success",
        title: "回测结束",
        detail: "任务结束。",
        created_at: "2026-03-07T10:05:00+08:00",
        updated_at: "2026-03-07T10:05:00+08:00",
        source: "backtest_runner"
      }
    ] as const;

    const mounted = mount(
      <OperationFeedbackCenter
        items={[...items]}
        latestItem={null}
        isMobileViewport={false}
        mobileEntryMode="external"
        externalOpenSignal={0}
        onDismiss={dismiss}
        onDismissNotice={dismissNotice}
        onClear={clear}
      />
    );

    mounted.rerender(
      <OperationFeedbackCenter
        items={[...items]}
        latestItem={null}
        isMobileViewport={false}
        mobileEntryMode="external"
        externalOpenSignal={1}
        onDismiss={dismiss}
        onDismissNotice={dismissNotice}
        onClear={clear}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).toContain("当前需关注");
    expect(text).toContain("最近记录");
    expect(text).toContain("监测延迟");
    expect(text).toContain("回测结束");
    expect(text).not.toContain("全部类别");
    expect(text).not.toContain("实盘监测");

    mounted.unmount();
  });
});
