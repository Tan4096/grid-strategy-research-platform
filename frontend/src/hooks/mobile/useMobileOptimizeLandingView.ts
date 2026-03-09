import { useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../../lib/storage";
import { MobileOptimizeLandingView, OptimizationStatusResponse } from "../../types";

function normalizeMobileOptimizeLandingView(value: unknown): MobileOptimizeLandingView | null {
  if (value === "runtime" || value === "results") {
    return value;
  }
  if (value === "history_overlay") {
    return "results";
  }
  return null;
}

function hasCompletedResults(status: OptimizationStatusResponse | null): boolean {
  if (!status) {
    return false;
  }
  if (status.best_row) {
    return true;
  }
  return Array.isArray(status.rows) && status.rows.length > 0;
}

function resolveDefaultLandingView(status: OptimizationStatusResponse | null): MobileOptimizeLandingView {
  return hasCompletedResults(status) ? "results" : "runtime";
}

function readLandingViewFromSession(
  fallback: MobileOptimizeLandingView
): MobileOptimizeLandingView {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.mobileOptimizeLandingViewV2);
    const normalized = normalizeMobileOptimizeLandingView(raw);
    if (normalized) {
      return fallback === "results" ? "results" : normalized;
    }
    const legacy = window.sessionStorage.getItem(STORAGE_KEYS.mobileOptimizeSubtab);
    const normalizedLegacy = normalizeMobileOptimizeLandingView(legacy);
    if (normalizedLegacy) {
      return fallback === "results" ? "results" : normalizedLegacy;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writeLandingViewToSession(view: MobileOptimizeLandingView): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.mobileOptimizeLandingViewV2, view);
  } catch {
    // ignore session storage errors
  }
}

export function useMobileOptimizeLandingView(
  optimizationStatus: OptimizationStatusResponse | null
): [MobileOptimizeLandingView, (next: MobileOptimizeLandingView) => void] {
  const defaultView = useMemo(
    () => resolveDefaultLandingView(optimizationStatus),
    [optimizationStatus]
  );
  const [view, setView] = useState<MobileOptimizeLandingView>(() =>
    readLandingViewFromSession(defaultView)
  );

  useEffect(() => {
    const next = readLandingViewFromSession(defaultView);
    setView(next);
  }, [defaultView]);

  useEffect(() => {
    writeLandingViewToSession(view);
  }, [view]);

  return [view, setView];
}

export function getMobileOptimizeDefaultLandingView(
  optimizationStatus: OptimizationStatusResponse | null
): MobileOptimizeLandingView {
  return resolveDefaultLandingView(optimizationStatus);
}

export function normalizeStoredMobileOptimizeLandingView(
  value: unknown
): MobileOptimizeLandingView | null {
  return normalizeMobileOptimizeLandingView(value);
}
