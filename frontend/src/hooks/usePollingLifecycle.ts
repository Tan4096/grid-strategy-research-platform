import { useCallback, useEffect, useRef, useState } from "react";

interface Params {
  enabled: boolean;
  onResume?: (() => void) | null;
  resumeThrottleMs?: number;
}

interface Result {
  nextRunAt: number | null;
  schedule: (delayMs: number, task: () => void) => void;
  clear: () => void;
  isPageVisible: () => boolean;
  triggerResume: () => void;
}

export function usePollingLifecycle({
  enabled,
  onResume = null,
  resumeThrottleMs = 1_000
}: Params): Result {
  const timerRef = useRef<number | null>(null);
  const resumeRef = useRef<(() => void) | null>(onResume);
  const lastResumeAtRef = useRef(0);
  const [nextRunAt, setNextRunAt] = useState<number | null>(null);

  useEffect(() => {
    resumeRef.current = onResume;
  }, [onResume]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setNextRunAt(null);
  }, []);

  const isPageVisible = useCallback(() => {
    if (typeof document === "undefined") {
      return true;
    }
    return document.visibilityState === "visible";
  }, []);

  const schedule = useCallback(
    (delayMs: number, task: () => void) => {
      clear();
      const safeDelayMs = Math.max(0, delayMs);
      setNextRunAt(Date.now() + safeDelayMs);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setNextRunAt(null);
        task();
      }, safeDelayMs);
    },
    [clear]
  );

  const triggerResume = useCallback(() => {
    if (!enabled || !resumeRef.current) {
      return;
    }
    const now = Date.now();
    if (now - lastResumeAtRef.current < resumeThrottleMs) {
      return;
    }
    lastResumeAtRef.current = now;
    clear();
    resumeRef.current();
  }, [clear, enabled, resumeThrottleMs]);

  useEffect(() => {
    if (!enabled) {
      clear();
    }
  }, [clear, enabled]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined" || !enabled || !resumeRef.current) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerResume();
      }
    };
    const handleFocus = () => {
      if (isPageVisible()) {
        triggerResume();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
    };
  }, [enabled, isPageVisible, triggerResume]);

  useEffect(
    () => () => {
      clear();
    },
    [clear]
  );

  return {
    nextRunAt,
    schedule,
    clear,
    isPageVisible,
    triggerResume
  };
}
