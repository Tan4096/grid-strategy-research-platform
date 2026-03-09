import { STORAGE_KEYS } from "./storage";
import { MobilePrimaryTab } from "../types";

export type AppMode = "backtest" | "optimize";

export function normalizeMobilePrimaryTab(value: unknown): MobilePrimaryTab | null {
  if (value === "params" || value === "backtest" || value === "optimize" || value === "live") {
    return value;
  }
  return null;
}

export function readMobilePrimaryTabFromSession(defaultTab: MobilePrimaryTab = "params"): MobilePrimaryTab {
  if (typeof window === "undefined") {
    return defaultTab;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.mobilePrimaryTab);
    return normalizeMobilePrimaryTab(raw) ?? defaultTab;
  } catch {
    return defaultTab;
  }
}

export function writeMobilePrimaryTabToSession(tab: MobilePrimaryTab): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.mobilePrimaryTab, tab);
  } catch {
    // ignore storage errors
  }
}

export function resolveMobilePrimaryTabAfterRun(mode: AppMode): MobilePrimaryTab {
  return mode === "optimize" ? "optimize" : "backtest";
}
