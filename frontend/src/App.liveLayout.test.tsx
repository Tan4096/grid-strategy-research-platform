import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const runBacktestSpy = vi.fn();

vi.mock("./components/app/OperationFeedbackCenter", () => ({ default: () => null }));
vi.mock("./components/app/MobileBottomTabBar", () => ({ default: () => null }));
vi.mock("./components/app/AppTopBar", () => ({
  default: ({ onModeChange, mode }: { onModeChange: (mode: "backtest" | "optimize" | "live") => void; mode: string }) => (
    <div data-testid="topbar">
      <span>{mode}</span>
      <button type="button" onClick={() => onModeChange("live")}>go-live</button>
    </div>
  )
}));
vi.mock("./components/ParameterForm", () => ({
  default: ({ mode }: { mode: string }) => <aside data-testid="parameter-form">parameter-{mode}</aside>
}));
vi.mock("./components/LiveConnectionPanel", () => ({
  default: () => <section data-testid="live-connection">live-connection</section>
}));
vi.mock("./components/BacktestPanel", () => ({
  default: () => <section data-testid="backtest-panel">backtest-panel</section>
}));
vi.mock("./components/OptimizationPanel", () => ({
  default: () => <section data-testid="optimization-panel">optimization-panel</section>
}));
vi.mock("./components/LiveTradingPanel", () => ({
  default: ({ onRunBacktest }: { onRunBacktest: () => void }) => (
    <section data-testid="live-trading-panel">
      <button type="button" onClick={onRunBacktest}>run-live-backtest</button>
    </section>
  )
}));
vi.mock("./hooks/responsive/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("./hooks/responsive/useMobileBottomInset", () => ({ useMobileBottomInset: () => undefined }));
vi.mock("./hooks/useOperationFeedback", () => ({
  useOperationFeedback: () => ({
    operationFeedbackItems: [],
    latestOperationFeedback: null,
    emitOperationEvent: vi.fn(),
    emitOperationFeedback: vi.fn(),
    dismissOperationFeedback: vi.fn(),
    dismissLatestNotice: vi.fn(),
    clearOperationFeedback: vi.fn(),
    mergeOperationRecords: vi.fn(),
    upsertOperationRecord: vi.fn()
  })
}));
vi.mock("./hooks/usePersistedBacktestRequest", () => ({
  usePersistedBacktestRequest: () => ({
    request: {
      strategy: {
        side: "short",
        lower: 65000,
        upper: 71000,
        grids: 6,
        leverage: 8,
        margin: 1000,
        stop_loss: 72000,
        use_base_position: false,
        strict_risk_control: true,
        reopen_after_stop: true,
        fee_rate: 0.0004,
        maker_fee_rate: 0.0002,
        taker_fee_rate: 0.0004,
        slippage: 0.0002,
        maintenance_margin_rate: 0.005,
        funding_rate_per_8h: 0,
        funding_interval_hours: 8,
        price_tick_size: 0.1,
        quantity_step_size: 0.001,
        min_notional: 5
      },
      data: {
        source: "binance",
        symbol: "ETHUSDT",
        interval: "1h",
        lookback_days: 7,
        start_time: "2026-03-01T00:00:00+08:00",
        end_time: null,
              }
    },
    setRequest: vi.fn(),
    requestReady: true
  })
}));
vi.mock("./hooks/usePersistedOptimizationConfig", () => ({
  usePersistedOptimizationConfig: () => ({
    optimizationConfig: {
      optimization_mode: "grid",
      leverage: { enabled: false, start: null, end: null, step: null, values: null },
      grids: { enabled: false, start: null, end: null, step: null, values: null },
      band_width_pct: { enabled: false, start: null, end: null, step: null, values: null },
      stop_loss_ratio_pct: { enabled: false, start: null, end: null, step: null, values: null },
      optimize_base_position: false,
      anchor_mode: "BACKTEST_START_PRICE",
      target: "total_return",
      min_closed_trades: 0,
      require_positive_return: false,
      robust_validation_weight: 0,
      robust_gap_penalty: 0,
      max_combinations: 100,
      max_trials: 100,
      auto_limit_combinations: true,
      max_workers: 1,
      batch_size: 1,
      chunk_size: 1,
      warmup_ratio: 0,
      resume_study: false,
      bayesian_adaptive_fallback_enabled: false,
      bayesian_adaptive_slowdown_factor: 1,
      bayesian_adaptive_window_batches: 1,
      bayesian_adaptive_min_trials_after_warmup: 1,
      enable_early_pruning: false,
      drawdown_prune_multiplier: 1,
      enable_profit_pruning: false,
      pruning_steps: 1,
      enable_topk_refine: false,
      topk_refine_k: 1,
      refine_leverage_delta: 0,
      refine_grids_delta: 0,
      refine_band_delta_pct: 0,
      refine_stop_delta_pct: 0,
      walk_forward_enabled: false,
      train_ratio: 0.5
    },
    setOptimizationConfig: vi.fn(),
    optimizationConfigReady: true
  })
}));
vi.mock("./hooks/usePersistedLiveTradingConfig", () => ({
  usePersistedLiveTradingConfig: () => ({
    draft: {
      algo_id: "123456",
      profiles: {
        binance: { api_key: "", api_secret: "", passphrase: "" },
        bybit: { api_key: "", api_secret: "", passphrase: "" },
        okx: { api_key: "", api_secret: "", passphrase: "" }
      }
    },
    setDraft: vi.fn(),
    ready: true,
    clearCredentials: vi.fn(),
    getMonitoringPreference: () => ({
      monitoring_enabled: false,
      poll_interval_sec: 15,
      selected_scope: "running"
    }),
    updateMonitoringPreference: vi.fn()
  })
}));
vi.mock("./hooks/useMarketSync", () => ({
  useMarketSync: () => ({ marketParamsSyncing: false, marketParamsNote: null, syncMarketParams: vi.fn() })
}));
vi.mock("./hooks/useBacktestRunner", () => ({
  useBacktestRunner: () => ({
    result: { summary: { total_return_usdt: 0 }, events: [], trades: [], unrealized_pnl_curve: [], leverage_usage_curve: [], equity_curve: [], funding_entries: [] },
    loading: false,
    error: null,
    transportMode: "idle",
    runBacktest: runBacktestSpy,
    clearError: vi.fn(),
    reset: vi.fn()
  })
}));
vi.mock("./hooks/useOptimizationRunner", () => ({
  useOptimizationRunner: () => ([
    {
      optimizationError: null,
      optimizationStatus: null,
      optimizationEtaSeconds: null,
      optimizationTransportMode: "idle",
      optimizationHistory: [],
      optimizationHistoryLoading: false,
      optimizationHistoryHasMore: false,
      optimizationRunning: false,
      optimizationSortBy: "final_score",
      optimizationSortOrder: "desc",
      optimizationPageSize: 20,
      optimizationPage: 1,
      totalOptimizationPages: 1,
      optimizationResultTab: "table"
    },
    {
      startOptimizationRun: vi.fn(),
      exportOptimizationResult: vi.fn(),
      refreshOptimizationHistory: vi.fn(),
      loadMoreOptimizationHistory: vi.fn(),
      clearOptimizationHistory: vi.fn(),
      restoreOptimizationHistory: vi.fn(),
      loadOptimizationJob: vi.fn(),
      restartOptimizationJob: vi.fn(),
      cancelOptimizationRun: vi.fn(),
      setOptimizationSortBy: vi.fn(),
      setOptimizationSortOrder: vi.fn(),
      setOptimizationPageSize: vi.fn(),
      setOptimizationPage: vi.fn(),
      setOptimizationResultTab: vi.fn(),
      setOptimizationError: vi.fn()
    }
  ])
}));
vi.mock("./hooks/useLiveRobotList", () => ({
  useLiveRobotList: () => ({
    items: [],
    loading: false,
    error: null,
    refresh: vi.fn()
  })
}));
vi.mock("./hooks/useLiveTradingSync", () => ({
  useLiveTradingSync: () => ({
    snapshot: {
      account: {
        exchange: "okx",
        symbol: "BTCUSDT",
        exchange_symbol: "BTC-USDT-SWAP",
        algo_id: "123456",
        strategy_started_at: "2026-03-02T00:00:00+08:00",
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
        name: "测试机器人",
        state: "running",
        direction: "long",
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
        grid_profit: 1,
        floating_profit: 2,
        total_fee: 0.5,
        funding_fee: 0.2,
        total_pnl: 2.7,
        pnl_ratio: 0.12,
        stop_loss_price: 66000,
        take_profit_price: 73000,
        use_base_position: true
      },
      market_params: {
        source: "okx",
        symbol: "BTCUSDT",
        maker_fee_rate: 0.0002,
        taker_fee_rate: 0.0005,
        funding_rate_per_8h: 0.0001,
        funding_interval_hours: 8,
        price_tick_size: 0.1,
        quantity_step_size: 0.001,
        min_notional: 1,
        fetched_at: "2026-03-07T10:56:35.773+08:00",
        note: null
      },
      summary: {
        realized_pnl: 1,
        unrealized_pnl: 2,
        fees_paid: 0.5,
        funding_paid: 0.1,
        funding_net: 0.2,
        total_pnl: 2.7,
        position_notional: 1000,
        open_order_count: 0,
        fill_count: 0
      },
      position: {
        side: "long",
        quantity: 1,
        entry_price: 70000,
        mark_price: 70100,
        notional: 1000,
        leverage: 5,
        liquidation_price: 65000,
        margin_mode: "isolated",
        unrealized_pnl: 2,
        realized_pnl: 1
      },
      open_orders: [],
      fills: [],
      funding_entries: [],
      inferred_grid: {
        lower: 68000,
        upper: 72000,
        grid_count: 8,
        grid_spacing: 500,
        active_level_count: 0,
        active_levels: [],
        confidence: 0.8,
        use_base_position: true,
        side: "long",
        note: null
      },
      diagnostics: []
    },
    loading: false,
    error: null,
    autoRefreshPaused: false,
    autoRefreshPausedReason: null,
    monitoringActive: false,
    nextRefreshAt: null,
    trend: [],
    refresh: vi.fn(),
    stop: vi.fn(),
    clearError: vi.fn()
  })
}));
vi.mock("./hooks/useRiskAnchorAndPrechecks", () => ({
  useRiskAnchorAndPrechecks: () => ({
    backtestPrecheck: { errors: [], warnings: [] },
    optimizationConfigWithRiskCap: {},
    optimizationPrecheck: { errors: [], warnings: [] },
    riskAnchorPriceForPanel: null,
    riskAnchorTimeForPanel: null,
    riskAnchorLoadingForPanel: false,
    riskAnchorLabelForPanel: ""
  })
}));
vi.mock("./lib/api", () => ({
  fetchOperation: vi.fn(),
  fetchOperations: vi.fn().mockResolvedValue({ items: [] }),
  getApiErrorInfo: () => ({ message: "请求失败" })
}));

import App from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountedNode {
  container: HTMLDivElement;
  unmount: () => void;
}

async function mount(node: ReactNode): Promise<MountedNode> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(node);
    await Promise.resolve();
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

describe("App live desktop layout", () => {
  it("keeps parameter form on the left and shows live connection on the right", async () => {
    const mounted = await mount(<App />);

    const liveButton = Array.from(mounted.container.querySelectorAll("button")).find((item) => item.textContent === "go-live");
    await act(async () => {
      liveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const parameterForm = mounted.container.querySelector('[data-testid="parameter-form"]');
    const liveConnection = mounted.container.querySelector('[data-testid="live-connection"]');

    expect(parameterForm).not.toBeNull();
    expect(liveConnection).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="live-trading-panel"]')).not.toBeNull();
    expect(Boolean(parameterForm && liveConnection && (parameterForm.compareDocumentPosition(liveConnection) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);

    mounted.unmount();
  });

  it("aligns live rerun backtest request to fetched_at minute", async () => {
    runBacktestSpy.mockClear();
    const mounted = await mount(<App />);

    const liveButton = Array.from(mounted.container.querySelectorAll("button")).find((item) => item.textContent === "go-live");
    await act(async () => {
      liveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const runButton = Array.from(mounted.container.querySelectorAll("button")).find((item) => item.textContent === "run-live-backtest");
    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(runBacktestSpy).toHaveBeenCalledTimes(1);
    expect(runBacktestSpy.mock.calls[0][0].data.source).toBe("okx");
    expect(runBacktestSpy.mock.calls[0][0].data.symbol).toBe("BTCUSDT");
    expect(runBacktestSpy.mock.calls[0][0].data.start_time).toBe("2026-03-02T00:00:00+08:00");
    expect(runBacktestSpy.mock.calls[0][0].data.end_time).toBe("2026-03-07T02:56:00.000Z");

    mounted.unmount();
  });
});
