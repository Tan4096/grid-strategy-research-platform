import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "../../test-utils/renderHook";
import { createDefaultThemeSettings } from "../../lib/appTheme";

import { useThemeLayoutController } from "./useThemeLayoutController";

const originalLocalStorage = window.localStorage;

beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (memory.has(key) ? memory.get(key) ?? null : null),
      setItem: (key: string, value: string) => {
        memory.set(key, String(value));
      },
      removeItem: (key: string) => {
        memory.delete(key);
      }
    }
  });
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: originalLocalStorage
  });
});

describe("useThemeLayoutController", () => {
  it("removes legacy layout storage on mount", () => {
    window.localStorage.setItem("btc-grid-backtest:card-layout-snapshot:v2", JSON.stringify([{ key: "a" }]));
    window.localStorage.setItem("btc-grid-backtest:card-layout-snapshots-by-workspace:v1", JSON.stringify({ backtest: [] }));

    renderHook(() =>
      useThemeLayoutController({
        isMobileViewport: false,
        workspaceMode: "backtest",
        showToast: vi.fn()
      })
    );

    expect(window.localStorage.getItem("btc-grid-backtest:card-layout-snapshot:v2")).toBeNull();
    expect(window.localStorage.getItem("btc-grid-backtest:card-layout-snapshots-by-workspace:v1")).toBeNull();
  });

  it("saves and restores default theme settings", () => {
    const showToast = vi.fn();
    const hook = renderHook(() =>
      useThemeLayoutController({
        isMobileViewport: false,
        workspaceMode: "backtest",
        showToast
      })
    );

    act(() => {
      hook.value.setThemeSettings((prev) => ({
        ...prev,
        preset: "custom",
        customColor: "#123456",
        customBackground: "#111111"
      }));
    });

    act(() => {
      hook.value.handleSaveDefaultThemeAndLayout();
    });

    act(() => {
      hook.value.setThemeSettings((prev) => ({
        ...prev,
        preset: "emerald",
        customColor: "#abcdef",
        customBackground: "#222222"
      }));
    });

    act(() => {
      hook.value.handleRestoreDefaultThemeAndLayout();
    });

    expect(hook.value.themeSettings.preset).toBe("custom");
    expect(hook.value.themeSettings.customColor).toBe("#123456");
    expect(hook.value.themeSettings.customBackground).toBe("#111111");
    expect(showToast).toHaveBeenCalledWith("主题已设为默认。");
    expect(showToast).toHaveBeenCalledWith("默认主题已恢复。");
  });

  it("switches workspace immediately without layout confirmation", () => {
    const hook = renderHook(() =>
      useThemeLayoutController({
        isMobileViewport: false,
        workspaceMode: "backtest",
        showToast: vi.fn()
      })
    );
    const apply = vi.fn();

    act(() => {
      hook.value.confirmLayoutScopeSwitch("live", apply);
    });

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("hydrates theme settings from storage", () => {
    const defaults = createDefaultThemeSettings();
    window.localStorage.setItem(
      "btc-grid-backtest:theme-settings:v1",
      JSON.stringify({
        ...defaults,
        preset: "amber",
        customColor: "#ffaa00"
      })
    );

    const hook = renderHook(() =>
      useThemeLayoutController({
        isMobileViewport: false,
        workspaceMode: "backtest",
        showToast: vi.fn()
      })
    );

    expect(hook.value.themeSettings.preset).toBe("amber");
    expect(hook.value.themeSettings.customColor).toBe("#ffaa00");
  });
});
