import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import LiveOrderMiniChart from "./LiveOrderMiniChart";
import type { LiveMonitoringTrendPoint } from "../../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountedNode {
  container: HTMLDivElement;
  unmount: () => void;
}

function mount(node: ReactNode): MountedNode {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}

afterEach(() => {
  document.documentElement.classList.remove("theme-light");
});

describe("LiveOrderMiniChart", () => {
  it("shows left-side order labels and hover tooltip", () => {
    document.documentElement.classList.add("theme-light");
    const trend: LiveMonitoringTrendPoint[] = [
      { timestamp: "2026-03-10T10:00:00+08:00", total_pnl: 1, floating_profit: -1, funding_fee: 0.1, notional: 1000, mark_price: 70100 },
      { timestamp: "2026-03-10T10:05:00+08:00", total_pnl: 1.2, floating_profit: -1.2, funding_fee: 0.1, notional: 1000, mark_price: 70320 },
      { timestamp: "2026-03-10T10:10:00+08:00", total_pnl: 1.1, floating_profit: -1.1, funding_fee: 0.1, notional: 1000, mark_price: 70080 }
    ];
    const mounted = mount(
      <LiveOrderMiniChart
        trend={trend}
        currentPrice={70120}
        positionSide="short"
        positionQuantity={1}
        entryPrice={70000}
        buyLevels={[69400, 68800]}
        sellLevels={[70600, 71200]}
        fallbackLevels={[]}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).toContain("69400.00");
    expect(text).toContain("68800.00");
    expect(text).toContain("70600.00");
    expect(text).toContain("71200.00");
    expect(text).toContain("70120.00");

    const svg = mounted.container.querySelector('[data-testid="live-order-mini-chart"]');
    expect(svg).not.toBeNull();
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 960,
        height: 176,
        top: 0,
        left: 0,
        right: 960,
        bottom: 176,
        x: 0,
        y: 0,
        toJSON: () => undefined
      })
    });

    const hitArea = mounted.container.querySelector('[data-testid="live-order-hit-1"]');
    expect(hitArea).not.toBeNull();

    act(() => {
      hitArea?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 480, clientY: 80 }));
    });

    const tooltip = mounted.container.querySelector('[data-testid="live-order-mini-tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent ?? "").toContain("收");
    expect(tooltip?.textContent ?? "").toContain("2026");
    expect(mounted.container.querySelector('[data-testid="live-order-highlight-buy"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="live-order-highlight-sell"]')).not.toBeNull();

    mounted.unmount();
  });
});
