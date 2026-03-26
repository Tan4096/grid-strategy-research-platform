import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { BacktestResponse } from "../lib/api-schema";
import BacktestComparisonWorkspace from "./BacktestComparisonWorkspace";

vi.mock("./ComparisonLineChart", () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>
}));

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

function makeResult(totalReturn: number, maxDrawdown: number, winRate: number): BacktestResponse {
  return {
    summary: {
      total_return_usdt: totalReturn,
      max_drawdown_pct: maxDrawdown,
      win_rate: winRate,
      initial_margin: 1000
    },
    equity_curve: [
      { timestamp: "2026-03-01T00:00:00.000Z", value: 1000 },
      { timestamp: "2026-03-02T00:00:00.000Z", value: 1100 + totalReturn }
    ],
    drawdown_curve: [
      { timestamp: "2026-03-01T00:00:00.000Z", value: 0 },
      { timestamp: "2026-03-02T00:00:00.000Z", value: maxDrawdown / 100 }
    ],
    candles: [],
    grid_lines: [],
    unrealized_pnl_curve: [],
    margin_ratio_curve: [],
    leverage_usage_curve: [],
    liquidation_price_curve: [],
    analysis: null,
    scoring: null,
    events: [],
    trades: []
  } as unknown as BacktestResponse;
}

describe("BacktestComparisonWorkspace", () => {
  it("renders delta cards and chart sections for the candidate result", () => {
    const mounted = mount(
      <BacktestComparisonWorkspace
        baseResult={makeResult(120, 18, 0.52)}
        candidateResult={makeResult(200, 12, 0.61)}
        candidateLabel="组合 #7"
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).toContain("回测对比工作台");
    expect(text).toContain("当前参数 vs 组合 #7");
    expect(text).toContain("总收益");
    expect(text).toContain("+80.00 USDT");
    expect(text).toContain("收益率曲线对比");
    expect(text).toContain("回撤曲线对比");
    expect(text).toContain("持仓网格数对比");

    mounted.unmount();
  });
});
