import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "../../test-utils/renderHook";
import { useIsMobile } from "./useIsMobile";
import { useMediaQuery } from "./useMediaQuery";

type Listener = (event: MediaQueryListEvent) => void;

interface MockMediaList {
  readonly matches: boolean;
  media: string;
  onchange: Listener | null;
  addEventListener: (_type: "change", listener: Listener) => void;
  removeEventListener: (_type: "change", listener: Listener) => void;
  emit: (next: boolean) => void;
}

function createMockMediaList(query: string, initial: boolean): MockMediaList {
  let matches = initial;
  const listeners = new Set<Listener>();
  const mediaList: MockMediaList = {
    media: query,
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener(_type: "change", listener: Listener) {
      listeners.add(listener);
    },
    removeEventListener(_type: "change", listener: Listener) {
      listeners.delete(listener);
    },
    emit(next: boolean) {
      matches = next;
      const event = { matches: next, media: query } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
      mediaList.onchange?.(event);
    }
  };
  return mediaList;
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia
  });
});

describe("useMediaQuery", () => {
  it("returns fallback value when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined
    });

    const hook = renderHook(() => useMediaQuery("(max-width: 767px)", true));
    expect(hook.value).toBe(true);
    hook.unmount();
  });

  it("reads initial match state", () => {
    const media = createMockMediaList("(max-width: 767px)", true);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: ((_: string) => media as unknown as MediaQueryList) as typeof window.matchMedia
    });

    const hook = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(hook.value).toBe(true);
    hook.unmount();
  });

  it("updates when media query changes", () => {
    const media = createMockMediaList("(max-width: 767px)", false);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: ((_: string) => media as unknown as MediaQueryList) as typeof window.matchMedia
    });

    const hook = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(hook.value).toBe(false);

    act(() => {
      media.emit(true);
    });
    hook.rerender();
    expect(hook.value).toBe(true);

    act(() => {
      media.emit(false);
    });
    hook.rerender();
    expect(hook.value).toBe(false);

    hook.unmount();
  });

  it("useIsMobile proxies to mobile media query", () => {
    const media = createMockMediaList("(max-width: 767px)", true);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: ((_: string) => media as unknown as MediaQueryList) as typeof window.matchMedia
    });

    const hook = renderHook(() => useIsMobile());
    expect(hook.value).toBe(true);
    hook.unmount();
  });
});
