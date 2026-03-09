import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { buildLiveAlignedBacktestRequest } from "../../lib/liveBacktestAlignment";
import type { AppWorkspaceMode, LiveConnectionDraft, LiveMonitoringPreference, MobilePrimaryTab, ParameterMode } from "../../types";
import type { BacktestRequest, LiveExchange } from "../../lib/api-schema";
import { useLiveRobotList } from "../useLiveRobotList";
import { useLiveTradingSync } from "../useLiveTradingSync";
import type { EmitOperationEventInput } from "../useOperationFeedback";

type NotifyFn = (message: string | EmitOperationEventInput) => void;
type SetBacktestRequest = Dispatch<SetStateAction<BacktestRequest>>;
type SetLiveConnectionDraft = Dispatch<SetStateAction<LiveConnectionDraft>>;

interface Params {
  request: BacktestRequest;
  setRequest: SetBacktestRequest;
  setParameterMode: Dispatch<SetStateAction<ParameterMode>>;
  workspaceMode: AppWorkspaceMode;
  mobileMinimalLayoutEnabled: boolean;
  mobilePrimaryTab: MobilePrimaryTab;
  liveConnectionDraft: LiveConnectionDraft;
  setLiveConnectionDraft: SetLiveConnectionDraft;
  liveConnectionReady: boolean;
  getMonitoringPreference: (key: string) => LiveMonitoringPreference;
  updateMonitoringPreference: (
    key: string,
    updater:
      | LiveMonitoringPreference
      | ((prev: LiveMonitoringPreference) => LiveMonitoringPreference)
  ) => void;
  showToast: NotifyFn;
  notifyCenter: NotifyFn;
  runBacktest: (requestOverride?: BacktestRequest) => Promise<void>;
}

export interface LiveWorkspaceController {
  liveEnvironmentExchange: LiveExchange | null;
  liveEnvironmentSymbol: string;
  liveEnvironmentStartTime: string | null;
  liveMonitoringPreference: LiveMonitoringPreference;
  liveRobotItems: ReturnType<typeof useLiveRobotList>["items"];
  liveRobotListLoading: boolean;
  liveRobotListError: string | null;
  liveSnapshot: ReturnType<typeof useLiveTradingSync>["snapshot"];
  liveLoading: boolean;
  liveError: string | null;
  liveAutoRefreshPaused: boolean;
  liveAutoRefreshPausedReason: string | null;
  liveMonitoringActive: boolean;
  liveNextRefreshAt: number | null;
  liveTrend: ReturnType<typeof useLiveTradingSync>["trend"];
  liveRunBlockedReason: string | null;
  liveSelectedRobotMissing: boolean;
  refreshLiveRobotList: ReturnType<typeof useLiveRobotList>["refresh"];
  refreshLiveSnapshot: ReturnType<typeof useLiveTradingSync>["refresh"];
  handleClearLiveCredentials: () => void;
  handleLiveScopeChange: (scope: "running" | "recent") => void;
  handleLivePollIntervalChange: (seconds: 5 | 15 | 30 | 60) => void;
  handleSelectRecentLiveRobot: () => void;
  handleApplyLiveEnvironment: () => void;
  handleApplyLiveInferredGrid: () => void;
  handleApplyLiveParameters: () => void;
  handleRunLiveBacktest: () => void;
  handleApplySuggestedLiveWindow: (days: number) => void;
  handleStopLiveMonitoring: () => void;
}

export function useLiveWorkspaceController({
  request,
  setRequest,
  setParameterMode,
  workspaceMode,
  mobileMinimalLayoutEnabled,
  mobilePrimaryTab,
  liveConnectionDraft,
  setLiveConnectionDraft,
  liveConnectionReady,
  getMonitoringPreference,
  updateMonitoringPreference,
  showToast,
  notifyCenter,
  runBacktest
}: Params): LiveWorkspaceController {
  const livePanelActive =
    mobileMinimalLayoutEnabled ? mobilePrimaryTab === "live" : workspaceMode === "live";
  const liveEnvironmentExchange: LiveExchange | null =
    request.data.source === "binance" ||
    request.data.source === "bybit" ||
    request.data.source === "okx"
      ? request.data.source
      : null;
  const liveEnvironmentSymbol = (request.data.symbol ?? "").trim().toUpperCase();
  const liveEnvironmentStartTime = request.data.start_time ?? null;
  const liveCredentialProfile = liveConnectionDraft.profiles.okx;
  const liveAlgoId = liveConnectionDraft.algo_id.trim();
  const liveMonitoringPreferenceKey = useMemo(
    () => [liveEnvironmentExchange ?? "", liveEnvironmentSymbol].join("|"),
    [liveEnvironmentExchange, liveEnvironmentSymbol]
  );
  const liveMonitoringPreference = getMonitoringPreference(liveMonitoringPreferenceKey);
  const setLiveMonitoringPreference = useCallback(
    (
      updater:
        | LiveMonitoringPreference
        | ((prev: LiveMonitoringPreference) => LiveMonitoringPreference)
    ) => {
      updateMonitoringPreference(liveMonitoringPreferenceKey, updater);
    },
    [liveMonitoringPreferenceKey, updateMonitoringPreference]
  );

  const [pendingRecentRobotSwitch, setPendingRecentRobotSwitch] = useState(false);

  const {
    items: liveRobotItems,
    loading: liveRobotListLoading,
    error: liveRobotListError,
    refresh: refreshLiveRobotList
  } = useLiveRobotList({
    draft: liveConnectionDraft,
    exchange: liveEnvironmentExchange,
    active: livePanelActive,
    ready: liveConnectionReady,
    scope: liveMonitoringPreference.selected_scope,
    notifyCenter
  });

  const {
    snapshot: liveSnapshot,
    loading: liveLoading,
    error: liveError,
    autoRefreshPaused: liveAutoRefreshPaused,
    autoRefreshPausedReason: liveAutoRefreshPausedReason,
    monitoringActive: liveMonitoringActive,
    nextRefreshAt: liveNextRefreshAt,
    trend: liveTrend,
    refresh: refreshLiveSnapshot,
    stop: stopLiveMonitoring
  } = useLiveTradingSync({
    draft: liveConnectionDraft,
    exchange: liveEnvironmentExchange,
    symbol: liveEnvironmentSymbol,
    strategyStartedAt: liveEnvironmentStartTime,
    active: livePanelActive,
    ready: liveConnectionReady,
    monitoringEnabled: liveMonitoringPreference.monitoring_enabled,
    pollIntervalSec: liveMonitoringPreference.poll_interval_sec,
    monitoringScope: liveMonitoringPreference.selected_scope,
    onMonitoringEnabledChange: (next) =>
      setLiveMonitoringPreference((prev) => ({
        ...prev,
        monitoring_enabled: next
      })),
    notifyCenter,
    showToast
  });

  const selectedLiveRobot = liveRobotItems.find((item) => item.algo_id === liveAlgoId) ?? null;
  const currentSymbolRobotItems = useMemo(() => {
    const normalizedSymbol = liveEnvironmentSymbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return liveRobotItems;
    }
    const matched = liveRobotItems.filter((item) => item.symbol.trim().toUpperCase() === normalizedSymbol);
    return matched.length > 0 ? matched : liveRobotItems;
  }, [liveEnvironmentSymbol, liveRobotItems]);

  const liveSelectedRobotMissing = Boolean(
    liveAlgoId && !selectedLiveRobot && !liveRobotListLoading
  );

  const handleClearLiveCredentials = useCallback(() => {
    setLiveMonitoringPreference((prev) => ({
      ...prev,
      monitoring_enabled: false
    }));
    setLiveConnectionDraft((prev) => ({
      ...prev,
      algo_id: "",
      profiles: {
        ...prev.profiles,
        okx: {
          api_key: "",
          api_secret: "",
          passphrase: ""
        }
      }
    }));
  }, [setLiveConnectionDraft, setLiveMonitoringPreference]);

  const handleLiveScopeChange = useCallback((scope: "running" | "recent") => {
    setPendingRecentRobotSwitch(false);
    setLiveMonitoringPreference((prev) => ({
      ...prev,
      selected_scope: scope
    }));
  }, [setLiveMonitoringPreference]);

  const handleLivePollIntervalChange = useCallback((seconds: 5 | 15 | 30 | 60) => {
    setLiveMonitoringPreference((prev) => ({
      ...prev,
      poll_interval_sec: seconds
    }));
  }, [setLiveMonitoringPreference]);

  const handleSelectRecentLiveRobot = useCallback(() => {
    setPendingRecentRobotSwitch(true);
    setLiveMonitoringPreference((prev) => ({
      ...prev,
      selected_scope: "recent"
    }));
  }, [setLiveMonitoringPreference]);

  useEffect(() => {
    if (!pendingRecentRobotSwitch || liveRobotListLoading) {
      return;
    }
    if (!liveRobotItems.length) {
      showToast("当前范围内没有可选监测对象。请检查凭证或切换对象范围。");
    }
    setPendingRecentRobotSwitch(false);
  }, [liveRobotItems.length, liveRobotListLoading, pendingRecentRobotSwitch, showToast]);

  useEffect(() => {
    if (liveRobotListLoading) {
      return;
    }
    const selectedStillVisible = liveRobotItems.some((item) => item.algo_id === liveAlgoId);
    if (liveAlgoId && !selectedStillVisible) {
      setLiveConnectionDraft((prev) =>
        prev.algo_id
          ? {
              ...prev,
              algo_id: ""
            }
          : prev
      );
      return;
    }

    if (liveAlgoId || !liveEnvironmentSymbol || currentSymbolRobotItems.length !== 1) {
      return;
    }

    const onlyRobot = currentSymbolRobotItems[0];
    if (!onlyRobot) {
      return;
    }

    setLiveConnectionDraft((prev) =>
      prev.algo_id === onlyRobot.algo_id
        ? prev
        : {
            ...prev,
            algo_id: onlyRobot.algo_id
          }
    );
  }, [
    currentSymbolRobotItems,
    liveAlgoId,
    liveEnvironmentSymbol,
    liveRobotItems,
    liveRobotListLoading,
    setLiveConnectionDraft
  ]);

  const liveRunBlockedReason = useMemo(() => {
    if (!liveEnvironmentExchange) {
      return "实盘监测需要交易所数据源，请先在左侧交易环境里选择 OKX。";
    }
    if (liveEnvironmentExchange !== "okx") {
      return "实盘监测目前仅支持 OKX algoId。";
    }
    if (!liveEnvironmentSymbol) {
      return "请先在左侧交易环境里填写交易对。";
    }
    if (!liveEnvironmentStartTime) {
      return "请先在左侧交易环境里填写策略起始时间。";
    }
    if (!liveCredentialProfile.api_key.trim()) {
      return "请先在右侧机器人连接里填写 OKX 的 API Key。";
    }
    if (!liveCredentialProfile.api_secret.trim()) {
      return "请先在右侧机器人连接里填写 OKX 的 API Secret。";
    }
    if (!(liveCredentialProfile.passphrase ?? "").trim()) {
      return "请先在右侧机器人连接里填写 OKX Passphrase。";
    }
    if (liveRobotListLoading) {
      return "正在读取当前 OKX 机器人列表，请稍候。";
    }
    if (liveRobotListError) {
      return `机器人列表加载失败：${liveRobotListError}`;
    }
    if (!liveRobotItems.length) {
      return liveMonitoringPreference.selected_scope === "recent"
        ? "当前 OKX 凭证下最近 7 天未找到可监测机器人。"
        : "当前 OKX 凭证下未找到运行中的网格机器人。";
    }
    if (!liveAlgoId) {
      return currentSymbolRobotItems.length > 1
        ? "当前交易对有多个机器人，请先选择一个 OKX 机器人（algoId）后再开始监测。"
        : "请选择一个 OKX 机器人（algoId）后再开始监测。";
    }
    if (!selectedLiveRobot) {
      return "当前选择的监测对象已不在最新列表中，请切到最近 7 天或重新选择。";
    }
    return null;
  }, [
    liveAlgoId,
    liveCredentialProfile,
    liveEnvironmentExchange,
    liveEnvironmentStartTime,
    liveEnvironmentSymbol,
    currentSymbolRobotItems.length,
    liveMonitoringPreference.selected_scope,
    liveRobotItems,
    liveRobotListError,
    liveRobotListLoading,
    selectedLiveRobot
  ]);

  const handleApplyLiveEnvironment = useCallback(() => {
    if (!liveSnapshot?.market_params) {
      showToast("当前无可回填环境。");
      return;
    }
    const market = liveSnapshot.market_params;
    const liveStart = liveSnapshot.account.strategy_started_at;
    setRequest((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        source: market.source,
        symbol: liveSnapshot.account.symbol,
        start_time: liveStart,
        end_time: null
      },
      strategy: {
        ...prev.strategy,
        fee_rate: market.taker_fee_rate,
        maker_fee_rate: market.maker_fee_rate,
        taker_fee_rate: market.taker_fee_rate,
        funding_rate_per_8h: market.funding_rate_per_8h,
        funding_interval_hours: market.funding_interval_hours,
        price_tick_size: market.price_tick_size,
        quantity_step_size: market.quantity_step_size,
        min_notional: market.min_notional
      }
    }));
    setParameterMode("backtest");
    showToast("监测环境已回填。");
  }, [liveSnapshot, setParameterMode, setRequest, showToast]);

  const handleApplyLiveInferredGrid = useCallback(() => {
    if (
      !liveSnapshot ||
      liveSnapshot.inferred_grid.lower === null ||
      liveSnapshot.inferred_grid.lower === undefined ||
      liveSnapshot.inferred_grid.upper === null ||
      liveSnapshot.inferred_grid.upper === undefined ||
      liveSnapshot.inferred_grid.grid_count === null ||
      liveSnapshot.inferred_grid.grid_count === undefined
    ) {
      showToast("挂单层级不足，无法回填网格。");
      return;
    }
    setRequest((prev) => ({
      ...prev,
      strategy: {
        ...prev.strategy,
        side:
          liveSnapshot.inferred_grid.side ??
          (liveSnapshot.position.side === "flat" ? prev.strategy.side : liveSnapshot.position.side),
        lower: liveSnapshot.inferred_grid.lower ?? prev.strategy.lower,
        upper: liveSnapshot.inferred_grid.upper ?? prev.strategy.upper,
        grids: liveSnapshot.inferred_grid.grid_count ?? prev.strategy.grids,
        use_base_position:
          liveSnapshot.inferred_grid.use_base_position ?? prev.strategy.use_base_position
      }
    }));
    setParameterMode("backtest");
    showToast("推断网格已回填。");
  }, [liveSnapshot, setParameterMode, setRequest, showToast]);

  const handleApplyLiveParameters = useCallback(() => {
    if (!liveSnapshot) {
      showToast("当前无可回填参数。");
      return;
    }
    if (!liveSnapshot.market_params) {
      showToast("当前无可回填环境。");
      return;
    }
    const market = liveSnapshot.market_params;
    const nextGrid =
      liveSnapshot.inferred_grid.lower !== null &&
      liveSnapshot.inferred_grid.lower !== undefined &&
      liveSnapshot.inferred_grid.upper !== null &&
      liveSnapshot.inferred_grid.upper !== undefined &&
      liveSnapshot.inferred_grid.grid_count !== null &&
      liveSnapshot.inferred_grid.grid_count !== undefined
        ? liveSnapshot.inferred_grid
        : null;

    setRequest((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        source: market.source,
        symbol: liveSnapshot.account.symbol,
        start_time: liveSnapshot.account.strategy_started_at,
        end_time: null
      },
      strategy: {
        ...prev.strategy,
        fee_rate: market.taker_fee_rate,
        maker_fee_rate: market.maker_fee_rate,
        taker_fee_rate: market.taker_fee_rate,
        funding_rate_per_8h: market.funding_rate_per_8h,
        funding_interval_hours: market.funding_interval_hours,
        price_tick_size: market.price_tick_size,
        quantity_step_size: market.quantity_step_size,
        min_notional: market.min_notional,
        ...(nextGrid
          ? {
              side:
                nextGrid.side ??
                (liveSnapshot.position.side === "flat" ? prev.strategy.side : liveSnapshot.position.side),
              lower: nextGrid.lower ?? prev.strategy.lower,
              upper: nextGrid.upper ?? prev.strategy.upper,
              grids: nextGrid.grid_count ?? prev.strategy.grids,
              use_base_position: nextGrid.use_base_position ?? prev.strategy.use_base_position
            }
          : {})
      }
    }));
    setParameterMode("backtest");
    showToast("监测参数已回填。");
  }, [liveSnapshot, setParameterMode, setRequest, showToast]);

  const handleRunLiveBacktest = useCallback(() => {
    if (!liveSnapshot) {
      void runBacktest();
      return;
    }
    void runBacktest(buildLiveAlignedBacktestRequest(request, liveSnapshot));
  }, [liveSnapshot, request, runBacktest]);

  const handleApplySuggestedLiveWindow = useCallback((days: number) => {
    if (!liveSnapshot) {
      return;
    }
    const comparedEndRaw = liveSnapshot.window?.compared_end_at ?? liveSnapshot.account.fetched_at;
    const comparedEnd = new Date(comparedEndRaw);
    if (Number.isNaN(comparedEnd.getTime())) {
      return;
    }
    comparedEnd.setUTCDate(comparedEnd.getUTCDate() - Math.max(1, Math.round(days)));
    comparedEnd.setUTCSeconds(0, 0);
    const nextStart = comparedEnd.toISOString();

    setRequest((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        start_time: nextStart
      }
    }));
    showToast(`监测窗口已缩短至近 ${Math.max(1, Math.round(days))} 天。`);
  }, [liveSnapshot, setRequest, showToast]);

  const handleStopLiveMonitoring = useCallback(() => {
    stopLiveMonitoring();
    showToast("实盘监测已停止。");
  }, [showToast, stopLiveMonitoring]);

  return {
    liveEnvironmentExchange,
    liveEnvironmentSymbol,
    liveEnvironmentStartTime,
    liveMonitoringPreference,
    liveRobotItems,
    liveRobotListLoading,
    liveRobotListError,
    liveSnapshot,
    liveLoading,
    liveError,
    liveAutoRefreshPaused,
    liveAutoRefreshPausedReason,
    liveMonitoringActive,
    liveNextRefreshAt,
    liveTrend,
    liveRunBlockedReason,
    liveSelectedRobotMissing,
    refreshLiveRobotList,
    refreshLiveSnapshot,
    handleClearLiveCredentials,
    handleLiveScopeChange,
    handleLivePollIntervalChange,
    handleSelectRecentLiveRobot,
    handleApplyLiveEnvironment,
    handleApplyLiveInferredGrid,
    handleApplyLiveParameters,
    handleRunLiveBacktest,
    handleApplySuggestedLiveWindow,
    handleStopLiveMonitoring
  };
}
