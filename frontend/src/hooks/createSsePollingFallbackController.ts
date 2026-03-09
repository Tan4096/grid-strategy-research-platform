import type { JobTransportMode } from "../types";

interface Params {
  streamUrl: string;
  setTransportMode: (mode: JobTransportMode) => void;
  isStopped: () => boolean;
  isPollingActive: () => boolean;
  onStartPollingFallback: () => void;
  onUpdate: (event: MessageEvent<string>) => void;
  onOpen?: () => void;
  onStreamError?: () => void;
  onResumePolling?: () => void;
  onResumeStreaming?: () => void;
  connectTimeoutMs?: number;
}

interface Controller {
  start: () => void;
  resume: () => void;
  cleanup: () => void;
}

export function createSsePollingFallbackController({
  streamUrl,
  setTransportMode,
  isStopped,
  isPollingActive,
  onStartPollingFallback,
  onUpdate,
  onOpen,
  onStreamError,
  onResumePolling,
  onResumeStreaming,
  connectTimeoutMs = 5_000
}: Params): Controller {
  let stream: EventSource | null = null;
  let connectingTimer: number | null = null;

  const clearConnectingTimer = () => {
    if (connectingTimer !== null) {
      window.clearTimeout(connectingTimer);
      connectingTimer = null;
    }
  };

  const closeStream = () => {
    stream?.close();
    stream = null;
  };

  const startPollingFallback = () => {
    if (isStopped() || isPollingActive()) {
      return;
    }
    clearConnectingTimer();
    closeStream();
    onStartPollingFallback();
  };

  const start = () => {
    if (typeof EventSource === "undefined") {
      startPollingFallback();
      return;
    }

    try {
      setTransportMode("connecting");
      stream = new EventSource(streamUrl);
      connectingTimer = window.setTimeout(() => {
        if (isStopped() || isPollingActive()) {
          return;
        }
        startPollingFallback();
      }, connectTimeoutMs);
    } catch {
      startPollingFallback();
      return;
    }

    stream.addEventListener("open", () => {
      if (isStopped()) {
        return;
      }
      clearConnectingTimer();
      setTransportMode("sse");
      onOpen?.();
    });

    stream.addEventListener("update", (event) => {
      if (isStopped()) {
        return;
      }
      onUpdate(event as MessageEvent<string>);
    });

    stream.addEventListener("error", () => {
      if (isStopped()) {
        return;
      }
      clearConnectingTimer();
      onStreamError?.();
      startPollingFallback();
    });
  };

  const resume = () => {
    if (isStopped()) {
      return;
    }
    if (isPollingActive()) {
      onResumePolling?.();
      return;
    }
    if (stream) {
      onResumeStreaming?.();
    }
  };

  const cleanup = () => {
    clearConnectingTimer();
    closeStream();
  };

  return {
    start,
    resume,
    cleanup
  };
}
