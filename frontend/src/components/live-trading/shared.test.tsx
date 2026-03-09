import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportLedgerCsv } from "./shared";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:ledger")
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(() => undefined)
  });
});

afterEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectURL
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectURL
  });
  vi.restoreAllMocks();
});

describe("exportLedgerCsv", () => {
  it("creates and clicks a download link for the current ledger rows", () => {
    const createElement = vi.spyOn(document, "createElement");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    exportLedgerCsv([
      {
        timestamp: "2026-03-07T09:30:00+08:00",
        kind: "trade",
        amount: 8,
        pnl: 8,
        fee: 0,
        side: "sell",
        trade_id: "trade-1",
        note: "latest trade"
      }
    ]);

    const anchor = createElement.mock.results.find((item) => item.value instanceof HTMLAnchorElement)
      ?.value as HTMLAnchorElement | undefined;

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(anchor?.getAttribute("download")).toMatch(/^live-ledger-/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ledger");
  });
});
