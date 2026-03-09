import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "../../test-utils/renderHook";
import { useMobileBottomInset } from "./useMobileBottomInset";

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
      },
      clear: () => {
        memory.clear();
      }
    }
  });
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: originalLocalStorage
  });
  document.documentElement.style.setProperty("--mobile-bottom-reserved", "0px");
  document.documentElement.style.setProperty("--mobile-bottom-sticky-offset", "0px");
});

describe("useMobileBottomInset", () => {
  it("sets reserved css variable when enabled", () => {
    const hook = renderHook(() =>
      useMobileBottomInset({
        enabled: true,
        stickyActionVisible: true,
        floatingEntryVisible: true,
        bottomTabVisible: true,
        stickyActionHeightPx: 56,
        floatingEntryHeightPx: 40,
        bottomTabHeightPx: 64,
        gapPx: 8
      })
    );
    expect(hook.value.reserved_bottom_px).toBe(72);
    expect(hook.value.bottom_nav_px).toBe(72);
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-reserved")).toBe("72px");
    expect(document.documentElement.style.getPropertyValue("--mobile-bottom-sticky-offset")).toBe("72px");
    hook.unmount();
  });

  it("returns zero reserved height when disabled", () => {
    const hook = renderHook(() =>
      useMobileBottomInset({
        enabled: false,
        stickyActionVisible: true,
        floatingEntryVisible: true
      })
    );
    expect(hook.value.reserved_bottom_px).toBe(0);
    hook.unmount();
  });
});
