import { ReactNode } from "react";
import type { BacktestRequest, OptimizationConfig } from "../../../lib/api-schema";
import OptimizationTemplateSection from "../OptimizationTemplateSection";
import PositionSection from "../PositionSection";
import RangeSection from "../RangeSection";
import RiskSection from "../RiskSection";
import TimeRangeSection from "../TimeRangeSection";
import TradingEnvironmentSection from "../TradingEnvironmentSection";
import { MOBILE_PARAMETER_TABS, MobileParameterTab } from "../useParameterFormState";

interface Props {
  request: BacktestRequest;
  optimizationConfig: OptimizationConfig;
  onOptimizationConfigChange: (next: OptimizationConfig) => void;
  updateStrategy: <K extends keyof BacktestRequest["strategy"]>(
    key: K,
    value: BacktestRequest["strategy"][K]
  ) => void;
  updateData: <K extends keyof BacktestRequest["data"]>(key: K, value: BacktestRequest["data"][K]) => void;
  marketParamsSyncing: boolean;
  marketParamsNote: string | null;
  onSyncMarketParams: () => void;
  maxLossAnchorPrice?: number | null;
  maxLossAnchorTime?: string | null;
  maxLossAnchorLoading?: boolean;
  maxLossAnchorLabel?: string;
  startTimeInputValue: string;
  endTimeInputValue: string;
  useNowEndTime: boolean;
  beijingMinuteInputToIso: (value: string) => string | null;
  nowBeijingIsoMinute: () => string;
  isMobileViewport: boolean;
  mobileTab: MobileParameterTab;
  onMobileTabChange: (tab: MobileParameterTab) => void;
  mobileTabIncompleteCount: Record<MobileParameterTab, number>;
  mobileIncompleteTotal: number;
  actions?: ReactNode;
}

export default function OptimizationSections({
  request,
  optimizationConfig,
  onOptimizationConfigChange,
  updateStrategy,
  updateData,
  marketParamsSyncing,
  marketParamsNote,
  onSyncMarketParams,
  maxLossAnchorPrice = null,
  maxLossAnchorTime = null,
  maxLossAnchorLoading = false,
  maxLossAnchorLabel = "第一根K线收盘价",
  startTimeInputValue,
  endTimeInputValue,
  useNowEndTime,
  beijingMinuteInputToIso,
  nowBeijingIsoMinute,
  isMobileViewport,
  mobileTab,
  onMobileTabChange,
  mobileTabIncompleteCount,
  mobileIncompleteTotal,
  actions = null
}: Props) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <OptimizationTemplateSection config={optimizationConfig} onChange={onOptimizationConfigChange} />
      {actions}

      {isMobileViewport && (
        <section className="card-sub border border-slate-700/60 bg-slate-900/30 p-2">
          <div className="ui-tab-group w-full">
            {MOBILE_PARAMETER_TABS.map((item) => {
              const issueCount = mobileTabIncompleteCount[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`ui-tab ${mobileTab === item.key ? "is-active" : ""}`}
                  onClick={() => onMobileTabChange(item.key)}
                >
                  <span>{item.label}</span>
                  {issueCount > 0 && (
                    <span className="ml-1 inline-flex min-w-[1.05rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
                      {issueCount > 9 ? "9+" : issueCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-1 px-0.5 text-[11px] text-slate-400">必填未完成：{mobileIncompleteTotal}</p>
        </section>
      )}

      {!isMobileViewport ? (
        <TradingEnvironmentSection
          request={request}
          updateData={updateData}
          marketParamsSyncing={marketParamsSyncing}
          marketParamsNote={marketParamsNote}
          onSyncMarketParams={onSyncMarketParams}
          startTimeInputValue={startTimeInputValue}
          endTimeInputValue={endTimeInputValue}
          useNowEndTime={useNowEndTime}
          beijingMinuteInputToIso={beijingMinuteInputToIso}
          nowBeijingIsoMinute={nowBeijingIsoMinute}
        />
      ) : mobileTab === "time" ? (
        <TimeRangeSection
          startTimeInputValue={startTimeInputValue}
          endTimeInputValue={endTimeInputValue}
          useNowEndTime={useNowEndTime}
          updateData={updateData}
          beijingMinuteInputToIso={beijingMinuteInputToIso}
          nowBeijingIsoMinute={nowBeijingIsoMinute}
        />
      ) : null}
      {(!isMobileViewport || mobileTab === "range") && (
        <RangeSection request={request} updateStrategy={updateStrategy} updateData={updateData} />
      )}
      {(!isMobileViewport || mobileTab === "position") && (
        <PositionSection request={request} updateStrategy={updateStrategy} />
      )}
      {(!isMobileViewport || mobileTab === "risk") && (
        <RiskSection
          request={request}
          updateStrategy={updateStrategy}
          riskAnchorMode={optimizationConfig.anchor_mode}
          onRiskAnchorModeChange={(mode) => onOptimizationConfigChange({ ...optimizationConfig, anchor_mode: mode })}
          riskCustomAnchorPrice={optimizationConfig.custom_anchor_price ?? null}
          onRiskCustomAnchorPriceChange={(value) =>
            onOptimizationConfigChange({ ...optimizationConfig, custom_anchor_price: value })
          }
          maxLossAnchorPrice={maxLossAnchorPrice}
          maxLossAnchorTime={maxLossAnchorTime}
          maxLossAnchorLoading={maxLossAnchorLoading}
          maxLossAnchorLabel={maxLossAnchorLabel}
          showMaxLossRequiredHint
        />
      )}
      {isMobileViewport && mobileTab === "env" && (
        <TradingEnvironmentSection
          request={request}
          updateData={updateData}
          marketParamsSyncing={marketParamsSyncing}
          marketParamsNote={marketParamsNote}
          onSyncMarketParams={onSyncMarketParams}
        />
      )}
    </div>
  );
}
