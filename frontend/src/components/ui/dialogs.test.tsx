import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";
import InputDialog from "./InputDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountedDialog {
  container: HTMLDivElement;
  rerender: (node: ReactNode) => void;
  unmount: () => void;
}

function mount(node: ReactNode): MountedDialog {
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

afterEach(() => {
  vi.useRealTimers();
});

describe("ConfirmDialog", () => {
  it("supports escape close, focus trap and focus restore", () => {
    vi.useFakeTimers();
    const cancelSpy = vi.fn();
    const confirmSpy = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const mounted = mount(
      <ConfirmDialog
        open
        title="确认清空"
        message="继续将清空任务"
        onCancel={cancelSpy}
        onConfirm={confirmSpy}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    const dialog = mounted.container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");

    const buttons = Array.from(mounted.container.querySelectorAll("button"));
    const cancelButton = buttons[0];
    const confirmButton = buttons[1];
    confirmButton.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(cancelButton);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(confirmButton);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    mounted.rerender(
      <ConfirmDialog
        open={false}
        title="确认清空"
        message="继续将清空任务"
        onCancel={cancelSpy}
        onConfirm={confirmSpy}
      />
    );
    expect(document.activeElement).toBe(trigger);

    mounted.unmount();
    trigger.remove();
  });
});

describe("InputDialog", () => {
  it("supports dialog semantics, esc close and keyboard focus trap", () => {
    vi.useFakeTimers();
    const cancelSpy = vi.fn();
    const confirmSpy = vi.fn();

    const mounted = mount(
      <InputDialog
        open
        title="请输入模板名"
        defaultValue="模板A"
        onCancel={cancelSpy}
        onConfirm={confirmSpy}
      />
    );

    act(() => {
      vi.runAllTimers();
    });

    const dialog = mounted.container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");

    const input = mounted.container.querySelector("input");
    expect(document.activeElement).toBe(input);

    const buttons = Array.from(mounted.container.querySelectorAll("button"));
    const confirmButton = buttons[1];

    confirmButton.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(input);

    input?.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(confirmButton);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(cancelSpy).toHaveBeenCalledTimes(1);

    mounted.unmount();
  });
});
