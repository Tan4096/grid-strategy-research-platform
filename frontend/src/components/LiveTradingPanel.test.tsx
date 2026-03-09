import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { BacktestRequest, LiveSnapshotResponse } from "../types";
import LiveTradingPanel from "./LiveTradingPanel";

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

const request: BacktestRequest = {
  strategy: {
    side: "long",
    lower: 68000,
    upper: 72000,
    grids: 8,
    leverage: 5,
    margin: 1000,
    stop_loss: 66000,
    use_base_position: true,
    strict_risk_control: true,
    reopen_after_stop: true,
    fee_rate: 0.0004,
    maker_fee_rate: 0.0002,
    taker_fee_rate: 0.0005,
    slippage: 0,
    maintenance_margin_rate: 0.005,
    funding_rate_per_8h: 0,
    funding_interval_hours: 8,
    use_mark_price_for_liquidation: false,
    price_tick_size: 0.1,
    quantity_step_size: 0.001,
    min_notional: 1,
    max_allowed_loss_usdt: 100
  },
  data: {
    source: "okx",
    symbol: "BTCUSDT",
    interval: "1h",
    start_time: "2026-03-01T00:00:00+08:00",
    end_time: null,
    lookback_days: 14,
      }
};

const snapshot: LiveSnapshotResponse = {
  account: {
    exchange: "okx",
    symbol: "BTCUSDT",
    exchange_symbol: "BTC-USDT-SWAP",
    algo_id: "123456",
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-07T10:56:35.773+08:00",
    masked_api_key: "abc***89"
  },
  monitoring: {
    poll_interval_sec: 15,
    last_success_at: "2026-03-07T10:56:35.773+08:00",
    freshness_sec: 0,
    stale: false,
    source_latency_ms: 120,
    fills_page_count: 1,
    fills_capped: false,
    orders_page_count: 1
  },
  robot: {
    algo_id: "123456",
    name: "BTC Grid",
    state: "running",
    direction: "short",
    algo_type: "contract_grid",
    run_type: "1",
    created_at: "2026-03-01T00:00:00+08:00",
    updated_at: "2026-03-07T10:56:35.773+08:00",
    investment_usdt: 1000,
    configured_leverage: 5,
    actual_leverage: 4.8,
    liquidation_price: 65000,
    grid_count: 8,
    lower_price: 68000,
    upper_price: 72000,
    grid_spacing: 500,
    grid_profit: 12,
    floating_profit: -2,
    total_fee: 1.5,
    funding_fee: 0.4,
    total_pnl: 10.9,
    pnl_ratio: 0.12,
    stop_loss_price: 66000,
    take_profit_price: 73000,
    use_base_position: true
  },
  market_params: null,
  summary: {
    realized_pnl: 12,
    unrealized_pnl: -2,
    fees_paid: 1.5,
    funding_paid: 0,
    funding_net: 0.4,
    total_pnl: 10.9,
    position_notional: 1000,
    open_order_count: 0,
    fill_count: 0
  },
  window: {
    strategy_started_at: "2026-03-01T00:00:00+08:00",
    fetched_at: "2026-03-07T10:56:35.773+08:00",
    compared_end_at: "2026-03-07T10:56:00+08:00"
  },
  completeness: {
    fills_complete: false,
    funding_complete: true,
    bills_window_clipped: false,
    partial_failures: ["fills_not_available"]
  },
  ledger_summary: {
    trading_net: 12.5,
    fees: 1.5,
    funding: 0.4,
    total_pnl: 10.9,
    realized: 12,
    unrealized: -2
  },
  position: {
    side: "short",
    quantity: 1,
    entry_price: 70000,
    mark_price: 70100,
    notional: 1000,
    leverage: 5,
    liquidation_price: 65000,
    margin_mode: "isolated",
    unrealized_pnl: -2,
    realized_pnl: 12
  },
  open_orders: [],
  fills: [],
  funding_entries: [],
  daily_breakdown: [],
  ledger_entries: [],
  inferred_grid: {
    lower: 68000,
    upper: 72000,
    grid_count: 8,
    grid_spacing: 500,
    active_level_count: 0,
    active_levels: [],
    confidence: 0.9,
    use_base_position: true,
    side: "short",
    note: null
  },
  diagnostics: [
    { level: "warning", code: "fills_not_available", message: "成交明细暂不可用", action_hint: "retry_sync" },
    { level: "info", code: "funding_source", message: "资金费来自机器人汇总", action_hint: null }
  ]
};

describe("LiveTradingPanel", () => {
  it("keeps the four main cards while removing compare from the ledger card", () => {
    const mounted = mount(
      <LiveTradingPanel
        request={request}
        backtestResult={null}
        snapshot={snapshot}
        loading={false}
        error={null}
        monitoringActive
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        nextRefreshAt={Date.now() + 15_000}
        trend={[]}
        onRefresh={() => undefined}
        onApplyParameters={() => undefined}
        onApplyEnvironment={() => undefined}
        onApplyInferredGrid={() => undefined}
        onRunBacktest={() => undefined}
        onApplySuggestedWindow={() => undefined}
        onStopMonitoring={() => undefined}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text.indexOf("监测总览")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("风险与配置")).toBeGreaterThan(text.indexOf("监测总览"));
    expect(text.indexOf("实盘曲线")).toBeGreaterThan(text.indexOf("风险与配置"));
    expect(text).toContain("运行中");
    expect(text).toContain("做空");
    expect(text).toContain("总收益");
    expect(text).toContain(" · 最大 ");
    expect(text).toContain("距止损距离");
    expect(text).toContain("运行状态");
    expect(text).toContain("当前价 70100.00 · 止损价 66000.00");
    expect(text.indexOf("总收益")).toBeLessThan(text.indexOf("最大回撤"));
    expect(text.indexOf("最大回撤")).toBeLessThan(text.indexOf("距止损距离"));
    expect(text.indexOf("距止损距离")).toBeLessThan(text.indexOf("运行状态"));
    expect(text).toContain("当前价格");
    expect(text).toContain("收益率曲线");
    expect(text).toContain("回撤曲线");
    expect(text).toContain("回撤 ");
    expect(text).toContain(" · 最大 ");
    expect(text).toContain("区间");
    expect(text).toContain("曲线起点");
    expect(text).toContain("回填到左侧参数");
    expect(text).not.toContain("监测详情");
    expect(text).not.toContain("回测对比");
    expect(text).not.toContain("可比较性");

    const cardTitles = ["监测总览", "风险与配置", "收益和趋势", "账单"];
    cardTitles.forEach((title) => {
      expect(mounted.container.textContent ?? "").toContain(title);
    });

    mounted.unmount();
  });

  it("applies only the configured risk tones inside the risk card", () => {
    const mounted = mount(
      <LiveTradingPanel
        request={request}
        backtestResult={null}
        snapshot={snapshot}
        loading={false}
        error={null}
        monitoringActive
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        nextRefreshAt={Date.now() + 15_000}
        trend={[]}
        onRefresh={() => undefined}
        onApplyParameters={() => undefined}
        onApplyEnvironment={() => undefined}
        onApplyInferredGrid={() => undefined}
        onRunBacktest={() => undefined}
        onApplySuggestedWindow={() => undefined}
        onStopMonitoring={() => undefined}
      />
    );

    const riskTitle = Array.from(mounted.container.querySelectorAll("h3")).find((item) => item.textContent === "风险与配置");
    const riskCard = riskTitle?.closest("section");
    const riskHtml = riskCard?.innerHTML ?? "";
    expect(riskHtml).toContain("border-emerald-400/35");
    expect(riskHtml).not.toContain("border-amber-400/35");

    mounted.unmount();
  });

  it("falls back to investment-based return rate when okx ratio is unavailable", () => {
    const mounted = mount(
      <LiveTradingPanel
        request={request}
        backtestResult={null}
        snapshot={{
          ...snapshot,
          robot: {
            ...snapshot.robot,
            pnl_ratio: null
          }
        }}
        loading={false}
        error={null}
        monitoringActive
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        nextRefreshAt={Date.now() + 15_000}
        trend={[]}
        onRefresh={() => undefined}
        onApplyParameters={() => undefined}
        onApplyEnvironment={() => undefined}
        onApplyInferredGrid={() => undefined}
        onRunBacktest={() => undefined}
        onApplySuggestedWindow={() => undefined}
        onStopMonitoring={() => undefined}
      />
    );

    expect(mounted.container.textContent ?? "").toContain("收益率曲线");
    mounted.unmount();
  });

  it("removes the current attention summary card from the live panel", () => {
    const mounted = mount(
      <LiveTradingPanel
        request={request}
        backtestResult={null}
        snapshot={snapshot}
        loading={false}
        error={null}
        monitoringActive
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        nextRefreshAt={Date.now() + 15_000}
        trend={[]}
        onRefresh={() => undefined}
        onApplyParameters={() => undefined}
        onApplyEnvironment={() => undefined}
        onApplyInferredGrid={() => undefined}
        onRunBacktest={() => undefined}
        onApplySuggestedWindow={() => undefined}
        onStopMonitoring={() => undefined}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).not.toContain("当前最需要处理");
    expect(text).not.toContain("查看其余 2 项");
    expect(text).not.toContain("监测详情");
    expect(text).not.toContain("对齐预览");
    expect(text).not.toContain("异常与缺口解释");

    mounted.unmount();
  });

  it("shows fills incomplete hint and defaults ledger to summary", () => {
    const mounted = mount(
      <LiveTradingPanel
        request={request}
        backtestResult={null}
        snapshot={snapshot}
        loading={false}
        error={null}
        monitoringActive
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        nextRefreshAt={Date.now() + 15_000}
        trend={[]}
        onRefresh={() => undefined}
        onApplyParameters={() => undefined}
        onApplyEnvironment={() => undefined}
        onApplyInferredGrid={() => undefined}
        onRunBacktest={() => undefined}
        onApplySuggestedWindow={() => undefined}
        onStopMonitoring={() => undefined}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).toContain("总净额");
    expect(text).not.toContain("当前没有按日汇总账单。");

    mounted.unmount();
  });

  it("shows only a minimal sync note instead of a banner", () => {
    const mounted = mount(
      <LiveTradingPanel
        request={request}
        backtestResult={null}
        snapshot={{
          ...snapshot,
          monitoring: {
            ...snapshot.monitoring,
            stale: true
          }
        }}
        loading={false}
        error={"API 限频"}
        monitoringActive={false}
        autoRefreshPaused
        autoRefreshPausedReason="API 限频"
        nextRefreshAt={null}
        trend={[]}
        onRefresh={() => undefined}
        onApplyParameters={() => undefined}
        onApplyEnvironment={() => undefined}
        onApplyInferredGrid={() => undefined}
        onRunBacktest={() => undefined}
        onApplySuggestedWindow={() => undefined}
        onStopMonitoring={() => undefined}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).not.toContain("数据同步异常");
    expect(text).not.toContain("重试");
    expect(text).toContain("API 限频");
    expect(text).not.toContain("当前显示最近一次成功数据");
    expect(text).not.toContain("自动刷新");
    expect(text).not.toContain("下次轮询");

    mounted.unmount();
  });

  it("hides the removed recent-change block", () => {
    const mounted = mount(
      <LiveTradingPanel
        request={request}
        backtestResult={null}
        snapshot={snapshot}
        loading={false}
        error={null}
        monitoringActive
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        nextRefreshAt={Date.now() + 15_000}
        trend={[]}
        onRefresh={() => undefined}
        onApplyParameters={() => undefined}
        onApplyEnvironment={() => undefined}
        onApplyInferredGrid={() => undefined}
        onRunBacktest={() => undefined}
        onApplySuggestedWindow={() => undefined}
        onStopMonitoring={() => undefined}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).not.toContain("最近一跳变化");

    mounted.unmount();
  });
});
