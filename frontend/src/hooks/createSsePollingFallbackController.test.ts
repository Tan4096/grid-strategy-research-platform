import { afterEach, describe, expect, it, vi } from "vitest";
import { createSsePollingFallbackController } from "./createSsePollingFallbackController";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private listeners = new Map<string, Array<(event?: Event | MessageEvent<string>) => void>>();
  closed = false;
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (event?: Event | MessageEvent<string>) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(handler);
    this.listeners.set(type, current);
  }
  emit(type: string, event?: Event | MessageEvent<string>) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
  FakeEventSource.instances = [];
  (window as any).EventSource = undefined;
});

describe("createSsePollingFallbackController", () => {
  it("connects to SSE, updates transport mode, and falls back on error", () => {
    (window as typeof window & { EventSource?: typeof EventSource }).EventSource = FakeEventSource as unknown as typeof EventSource;

    const setTransportMode = vi.fn();
    const onFallback = vi.fn();
    const onUpdate = vi.fn();
    const onOpen = vi.fn();
    const onStreamError = vi.fn();

    const controller = createSsePollingFallbackController({
      streamUrl: "http://localhost/stream",
      setTransportMode,
      isStopped: () => false,
      isPollingActive: () => false,
      onStartPollingFallback: onFallback,
      onUpdate,
      onOpen,
      onStreamError
    });

    controller.start();
    expect(setTransportMode).toHaveBeenCalledWith("connecting");
    expect(FakeEventSource.instances).toHaveLength(1);

    const stream = FakeEventSource.instances[0];
    stream.emit("open", new Event("open"));
    expect(setTransportMode).toHaveBeenCalledWith("sse");
    expect(onOpen).toHaveBeenCalledTimes(1);

    stream.emit("update", new MessageEvent("update", { data: "hello" }));
    expect(onUpdate).toHaveBeenCalledTimes(1);

    stream.emit("error", new Event("error"));
    expect(onStreamError).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(stream.closed).toBe(true);
  });

  it("uses timeout and resume hooks for polling/stream states", async () => {
    vi.useFakeTimers();
    (window as typeof window & { EventSource?: typeof EventSource }).EventSource = FakeEventSource as unknown as typeof EventSource;

    let pollingActive = false;
    const onFallback = vi.fn(() => {
      pollingActive = true;
    });
    const onResumePolling = vi.fn();
    const onResumeStreaming = vi.fn();

    const controller = createSsePollingFallbackController({
      streamUrl: "http://localhost/stream",
      setTransportMode: vi.fn(),
      isStopped: () => false,
      isPollingActive: () => pollingActive,
      onStartPollingFallback: onFallback,
      onUpdate: vi.fn(),
      onResumePolling,
      onResumeStreaming,
      connectTimeoutMs: 50
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(onFallback).toHaveBeenCalledTimes(1);

    controller.resume();
    expect(onResumePolling).toHaveBeenCalledTimes(1);

    pollingActive = false;
    const second = createSsePollingFallbackController({
      streamUrl: "http://localhost/stream-2",
      setTransportMode: vi.fn(),
      isStopped: () => false,
      isPollingActive: () => false,
      onStartPollingFallback: vi.fn(),
      onUpdate: vi.fn(),
      onResumeStreaming
    });
    second.start();
    second.resume();
    expect(onResumeStreaming).toHaveBeenCalledTimes(1);
  });
});
