import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "../test-utils/renderHook";
import { usePollingLifecycle } from "./usePollingLifecycle";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible"
  });
});

describe("usePollingLifecycle", () => {
  it("schedules and clears timeout state around a polling task", async () => {
    vi.useFakeTimers();
    const task = vi.fn();
    const hook = renderHook(() =>
      usePollingLifecycle({
        enabled: true
      })
    );

    act(() => {
      hook.value.schedule(2_000, task);
    });

    expect(hook.value.nextRunAt).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(task).toHaveBeenCalledTimes(1);
    expect(hook.value.nextRunAt).toBeNull();
    hook.unmount();
  });

  it("clears pending timer and resumes immediately when the page becomes visible", async () => {
    vi.useFakeTimers();
    const onResume = vi.fn();
    const hook = renderHook(() =>
      usePollingLifecycle({
        enabled: true,
        onResume
      })
    );

    act(() => {
      hook.value.schedule(5_000, vi.fn());
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden"
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(hook.value.nextRunAt).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(onResume).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(onResume).toHaveBeenCalledTimes(2);
    hook.unmount();
  });
});
