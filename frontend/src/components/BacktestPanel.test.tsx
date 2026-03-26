import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BacktestResponse } from "../lib/api-schema";
import BacktestPanel from "./BacktestPanel";

vi.mock("../hooks/responsive/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("./BacktestComparisonWorkspace", () => ({
  default: ({ candidateLabel }: { candidateLabel?: string | null }) => (
    <div data-testid="comparison-workspace">comparison:{candidateLabel ?? "none"}</div>
  )
}));
vi.mock("./BacktestEventsTimeline", () => ({ default: () => <div>events</div> }));
vi.mock("./LineChart", () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock("./MetricCards", () => ({ default: () => <div>metrics</div> }));
vi.mock("./PriceGridChart", () => ({ default: () => <div>price-grid</div> }));
vi.mock("./StrategyDiagnosisCard", () => ({ default: () => <div>diagnosis</div> }));
vi.mock("./StrategyRadarChart", () => ({ default: () => <div>radar</div> }));
vi.mock("./StrategyScoreCard", () => ({ default: () => <div>score</div> }));
vi.mock("./StrategyStatusBar", () => ({ default: () => <div>status</div> }));
vi.mock("./TradesTable", () => ({ default: () => <div>trades</div> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountedNode {
  container: HTMLDivElement;
  unmount: () => Promise<void>;
}

async function flushSuspenseUpdates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(node: ReactNode): Promise<MountedNode> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  await flushSuspenseUpdates();
  return {
    container,
    unmount: async () => {
      await flushSuspenseUpdates();
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  };
}

function makeResult(totalReturn = 120): BacktestResponse {
  return {
    summary: {
      total_return_usdt: totalReturn,
      max_drawdown_pct: 12,
      liquidation_count: 0,
      stop_loss_count: 0,
      funding_paid: 1,
      initial_margin: 1000,
      max_single_loss: 20,
      max_possible_loss_usdt: 120,
      average_holding_hours: 6,
      full_grid_profit_count: 3,
      total_closed_trades: 8,
      use_base_position: false,
      base_grid_count: 0,
      initial_position_size: 0,
      fees_paid: 1.5,
      funding_statement_amount: 0.5,
      total_return_pct: 12
    },
    analysis: null,
    scoring: null,
    candles: [],
    grid_lines: [],
    events: [],
    trades: [],
    equity_curve: [
      { timestamp: "2026-03-01T00:00:00.000Z", value: 1000 },
      { timestamp: "2026-03-02T00:00:00.000Z", value: 1120 }
    ],
    drawdown_curve: [],
    unrealized_pnl_curve: [],
    margin_ratio_curve: [],
    leverage_usage_curve: [],
    liquidation_price_curve: []
  } as unknown as BacktestResponse;
}

describe("BacktestPanel", () => {
  beforeAll(async () => {
    await Promise.all([
      import("./BacktestComparisonWorkspace"),
      import("./BacktestEventsTimeline"),
      import("./LineChart"),
      import("./MetricCards"),
      import("./PriceGridChart"),
      import("./StrategyDiagnosisCard"),
      import("./StrategyRadarChart"),
      import("./StrategyScoreCard"),
      import("./StrategyStatusBar"),
      import("./TradesTable")
    ]);
  });

  it("renders the comparison workspace when baseline and candidate results are both available", async () => {
    const mounted = await mount(
      <BacktestPanel
        error={null}
        result={makeResult(180)}
        comparisonBaselineResult={makeResult(120)}
        comparisonCandidateLabel="组合 #5"
        loading={false}
        transportMode="idle"
        symbol="BTCUSDT"
      />
    );

    expect(mounted.container.textContent ?? "").toContain("comparison:组合 #5");
    await mounted.unmount();
  });

  it("shows a compare-specific loading message while the candidate backtest is running", async () => {
    const mounted = await mount(
      <BacktestPanel
        error={null}
        result={null}
        comparisonBaselineResult={makeResult(120)}
        comparisonCandidateLabel="组合 #5"
        loading
        transportMode="polling"
        symbol="BTCUSDT"
      />
    );

    expect(mounted.container.textContent ?? "").toContain("对比回测生成中");
    await mounted.unmount();
  });
});
