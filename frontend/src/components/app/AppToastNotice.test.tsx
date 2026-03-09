import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import AppToastNotice from "./AppToastNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

const baseItem = {
  id: "toast-1",
  title: "布局已保存",
  detail: "当前布局保存成功。",
  category: "success" as const
};

describe("AppToastNotice", () => {
  it("pins desktop toast to the top-left corner", () => {
    const mounted = mount(
      <AppToastNotice
        item={baseItem}
        isMobileViewport={false}
        onClose={vi.fn()}
      />
    );

    const notice = mounted.container.querySelector(".toast-notice");
    expect(notice?.className).toContain("left-4");
    expect(notice?.className).toContain("top-4");
    expect(notice?.className).toContain("w-[360px]");
    expect(notice?.className).not.toContain("right-4");
    mounted.unmount();
  });

  it("pins mobile toast to the safe-area top-left corner", () => {
    const mounted = mount(
      <AppToastNotice
        item={baseItem}
        isMobileViewport
        onClose={vi.fn()}
      />
    );

    const notice = mounted.container.querySelector<HTMLElement>(".toast-notice");
    expect(notice?.className).toContain("left-4");
    expect(notice?.className).toContain("top-4");
    expect(notice?.style.left).toContain("env(safe-area-inset-left)");
    expect(notice?.style.left).toContain("0.5rem");
    expect(notice?.style.top).toContain("env(safe-area-inset-top)");
    expect(notice?.style.top).toContain("0.5rem");
    expect(notice?.style.width).toContain("360px");
    expect(notice?.style.width).toContain("100vw");
    expect(notice?.style.width).toContain("env(safe-area-inset-left)");
    expect(notice?.style.width).toContain("env(safe-area-inset-right)");
    mounted.unmount();
  });
});
