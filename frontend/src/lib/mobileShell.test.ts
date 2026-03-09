import { describe, expect, it } from "vitest";
import {
  normalizeMobilePrimaryTab,
  readMobilePrimaryTabFromSession,
  resolveMobilePrimaryTabAfterRun,
  writeMobilePrimaryTabToSession
} from "./mobileShell";
import { STORAGE_KEYS } from "./storage";

describe("mobileShell", () => {
  it("normalizes valid tabs and rejects invalid values", () => {
    expect(normalizeMobilePrimaryTab("params")).toBe("params");
    expect(normalizeMobilePrimaryTab("backtest")).toBe("backtest");
    expect(normalizeMobilePrimaryTab("optimize")).toBe("optimize");
    expect(normalizeMobilePrimaryTab("other")).toBeNull();
  });

  it("reads and writes tab state in sessionStorage", () => {
    writeMobilePrimaryTabToSession("optimize");
    expect(window.sessionStorage.getItem(STORAGE_KEYS.mobilePrimaryTab)).toBe("optimize");
    expect(readMobilePrimaryTabFromSession()).toBe("optimize");
  });

  it("maps run action to destination tab", () => {
    expect(resolveMobilePrimaryTabAfterRun("backtest")).toBe("backtest");
    expect(resolveMobilePrimaryTabAfterRun("optimize")).toBe("optimize");
  });
});

