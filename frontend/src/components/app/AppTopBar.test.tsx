import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import AppTopBar from "./AppTopBar";
import { createDefaultThemeSettings } from "../../lib/appTheme";

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

describe("AppTopBar", () => {
  it("shows mobile notification entry independent of optimize tab", () => {
    const openFeedback = vi.fn();
    const mounted = mount(
      <AppTopBar
        mode="backtest"
        onModeChange={vi.fn()}
        isMobileViewport
        currentMobilePrimaryTab="backtest"
        mobileStatusText="就绪"
        onOpenOperationFeedback={openFeedback}
        operationFeedbackCount={3}
        themePickerOpen={false}
        onToggleThemePicker={vi.fn()}
        themePickerRef={{ current: null }}
        themeSettings={createDefaultThemeSettings()}
        onThemeSettingsChange={vi.fn()}
        onSaveAsDefault={vi.fn()}
        onRestoreDefault={vi.fn()}
      />
    );

    const button = Array.from(mounted.container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("通知")
    );
    expect(button?.textContent).toContain("通知");
    expect(button?.textContent).toContain("3");

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openFeedback).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });
});
