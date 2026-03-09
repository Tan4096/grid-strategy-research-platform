import { useMemo, useState } from "react";
import {
  AnchorMode,
  BacktestRequest,
  MobileTemplateSheetMode,
  MobileParameterWizardStep,
  OptimizationConfig
} from "../types";
import OptimizationTemplateSection from "./parameter/OptimizationTemplateSection";
import MobileBlockedReasonSheet from "./parameter/MobileBlockedReasonSheet";
import MobileTemplateSheet from "./parameter/MobileTemplateSheet";
import PositionSection from "./parameter/PositionSection";
import RangeSection from "./parameter/RangeSection";
import RiskSection from "./parameter/RiskSection";
import StrategyTemplateSection from "./parameter/StrategyTemplateSection";
import TradingEnvironmentSection from "./parameter/TradingEnvironmentSection";
import BacktestSections from "./parameter/sections/BacktestSections";
import OptimizationSections from "./parameter/sections/OptimizationSections";
import {
  beijingMinuteInputToIso,
  nowBeijingIsoMinute,
  useParameterFormState
} from "./parameter/useParameterFormState";
import { useParameterWizardState } from "./parameter/useParameterWizardState";
import { inputClass } from "./parameter/shared";
import { useTemplateActions } from "./parameter/useTemplateActions";
import InputDialog from "./ui/InputDialog";

interface Props {
  mode: "backtest" | "optimize";
  onModeChange?: (mode: "backtest" | "optimize") => void;
  request: BacktestRequest;
  requestReady: boolean;
  onChange: (next: BacktestRequest) => void;
  optimizationConfig: OptimizationConfig;
  onOptimizationConfigChange: (next: OptimizationConfig) => void;
  onRun: () => void;
  loading: boolean;
  marketParamsSyncing: boolean;
  marketParamsNote: string | null;
  onSyncMarketParams: () => void;
  runLabel?: string;
  runningLabel?: string;
  runBlockedReason?: string | null;
  hideRunButton?: boolean;
  onSecondaryAction?: (() => void) | null;
  secondaryActionLabel?: string;
  secondaryActionDisabled?: boolean;
  onExport?: () => void;
  canExport?: boolean;
  exportLabel?: string;
  backtestRiskAnchorMode: AnchorMode;
  onBacktestRiskAnchorModeChange: (mode: AnchorMode) => void;
  backtestRiskCustomAnchorPrice: number | null;
  onBacktestRiskCustomAnchorPriceChange: (value: number | null) => void;
  maxLossAnchorPrice?: number | null;
  maxLossAnchorTime?: string | null;
  maxLossAnchorLoading?: boolean;
  maxLossAnchorLabel?: string;
  mobileMinimalLayoutEnabled?: boolean;
}

const WIZARD_STEP_META: Array<{ key: MobileParameterWizardStep; label: string }> = [
  { key: "environment", label: "交易环境" },
  { key: "strategy_position", label: "区间仓位" },
  { key: "risk_submit", label: "风控提交" }
];

export default function ParameterForm({
  mode,
  onModeChange,
  request,
  requestReady,
  onChange,
  optimizationConfig,
  onOptimizationConfigChange,
  onRun,
  loading,
  marketParamsSyncing,
  marketParamsNote,
  onSyncMarketParams,
  runLabel = "开始回测",
  runningLabel = "回测中...",
  runBlockedReason = null,
  hideRunButton = false,
  onSecondaryAction = null,
  secondaryActionLabel = "",
  secondaryActionDisabled = false,
  onExport,
  canExport = false,
  exportLabel = "导出 CSV",
  backtestRiskAnchorMode,
  onBacktestRiskAnchorModeChange,
  backtestRiskCustomAnchorPrice,
  onBacktestRiskCustomAnchorPriceChange,
  maxLossAnchorPrice = null,
  maxLossAnchorTime = null,
  maxLossAnchorLoading = false,
  maxLossAnchorLabel = "第一根K线收盘价",
  mobileMinimalLayoutEnabled = true
}: Props) {
  const {
    isMobileViewport,
    mobileTab,
    setMobileTab,
    mobileTabIncompleteCount,
    mobileIncompleteTotal,
    updateStrategy,
    updateData,
    startTimeInputValue,
    endTimeInputValue,
    useNowEndTime
  } = useParameterFormState({ request, onChange });

  const {
    importRef,
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplateLocked,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
    exportTemplate,
    importTemplate
  } = useTemplateActions({ request, requestReady, onChange });

  const {
    step: wizardStep,
    stepIndex: wizardStepIndex,
    stepCount: wizardStepCount,
    currentStepIncompleteCount,
    canGoPrev,
    canGoNext,
    goPrev,
    goNext,
    goToStep,
    jumpToSubmitStep
  } = useParameterWizardState({
    enabled: isMobileViewport,
    mobileTabIncompleteCount
  });

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogDefaultName, setSaveDialogDefaultName] = useState(request.data.symbol || "我的模板");
  const [mobileTemplateSheetOpen, setMobileTemplateSheetOpen] = useState(false);
  const [mobileBlockedReasonSheetOpen, setMobileBlockedReasonSheetOpen] = useState(false);
  const [mobileOptimizationTemplateName, setMobileOptimizationTemplateName] = useState("示例模板");
  const [mobileOptimizationTemplateId, setMobileOptimizationTemplateId] = useState("");


  const handleSaveTemplate = () => {
    const result = saveTemplate();
    if (result.status === "need-name") {
      setSaveDialogDefaultName(result.suggestedName);
      setSaveDialogOpen(true);
    }
  };

  const handleConfirmSaveTemplate = (name: string) => {
    const result = saveTemplate(name);
    if (result.status === "saved") {
      setSaveDialogOpen(false);
    }
  };

  const mobileWizardStepLabel = useMemo(() => {
    const found = WIZARD_STEP_META.find((item) => item.key === wizardStep);
    return found ? found.label : "";
  }, [wizardStep]);
  const selectedStrategyTemplateName = useMemo(() => {
    return templates.find((item) => item.id === selectedTemplateId)?.name ?? "示例模板";
  }, [selectedTemplateId, templates]);
  const mobileTemplateSummaryName =
    mode === "backtest" ? selectedStrategyTemplateName : mobileOptimizationTemplateName;
  const mobileTemplateSheetMode: MobileTemplateSheetMode =
    mode === "backtest" ? "strategy" : "optimization";
  const mobileBlockedSummaryText =
    mobileIncompleteTotal > 0 ? `当前仍有 ${mobileIncompleteTotal} 项未完成` : "当前仍无法开始";

  const actionButtons =
    !hideRunButton || onSecondaryAction || onExport ? (
      <div
        className={`space-y-1.5 ${
          isMobileViewport
            ? "sticky bottom-[calc(env(safe-area-inset-bottom)+0.25rem)] z-20 rounded-lg border border-slate-700/60 bg-slate-900/92 p-2 backdrop-blur"
            : ""
        }`}
        style={
          isMobileViewport
            ? {
                bottom:
                  "calc(env(safe-area-inset-bottom) + var(--mobile-bottom-sticky-offset, 0px) + 0.25rem)"
              }
            : undefined
        }
      >
        <div className={`grid gap-2 ${!hideRunButton && (onSecondaryAction || onExport) ? "grid-cols-2" : "grid-cols-1"}`}>
          {!hideRunButton && (
            <div>
              <button
                className="ui-btn ui-btn-primary w-full min-h-[44px]"
                onClick={() => {
                  jumpToSubmitStep();
                  onRun();
                }}
                disabled={loading || Boolean(runBlockedReason)}
                type="button"
                data-tour-id={mode === "backtest" ? "run-backtest-button" : "run-optimize-button"}
              >
                {loading ? runningLabel : runLabel}
              </button>
            </div>
          )}
          {onSecondaryAction && (
            <div>
              <button
                className="ui-btn ui-btn-secondary w-full min-h-[44px]"
                onClick={onSecondaryAction}
                disabled={secondaryActionDisabled}
                type="button"
              >
                {secondaryActionLabel}
              </button>
            </div>
          )}
          {onExport && (
            <div>
              <button
                className="ui-btn ui-btn-secondary w-full min-h-[44px]"
                onClick={onExport}
                disabled={!canExport}
                type="button"
              >
                {exportLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    ) : null;

  const renderMobileWizardContent = () => {
    if (wizardStep === "environment") {
      return (
        <div className="space-y-3">
          <TradingEnvironmentSection
            request={request}
            updateData={updateData}
            marketParamsSyncing={marketParamsSyncing}
            marketParamsNote={marketParamsNote}
            onSyncMarketParams={onSyncMarketParams}
            showExchangeParamsPanel
            startTimeInputValue={startTimeInputValue}
            endTimeInputValue={endTimeInputValue}
            useNowEndTime={useNowEndTime}
            beijingMinuteInputToIso={beijingMinuteInputToIso}
            nowBeijingIsoMinute={nowBeijingIsoMinute}
          />
        </div>
      );
    }

    if (wizardStep === "strategy_position") {
      return (
        <div className="space-y-3">
          <RangeSection request={request} updateStrategy={updateStrategy} updateData={updateData} />
          <PositionSection request={request} updateStrategy={updateStrategy} />
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <RiskSection
          request={request}
          updateStrategy={updateStrategy}
          riskAnchorMode={mode === "backtest" ? backtestRiskAnchorMode : optimizationConfig.anchor_mode}
          onRiskAnchorModeChange={(nextMode) => {
            if (mode === "backtest") {
              onBacktestRiskAnchorModeChange(nextMode);
              return;
            }
            onOptimizationConfigChange({
              ...optimizationConfig,
              anchor_mode: nextMode
            });
          }}
          riskCustomAnchorPrice={
            mode === "backtest"
              ? backtestRiskCustomAnchorPrice
              : optimizationConfig.custom_anchor_price ?? null
          }
          onRiskCustomAnchorPriceChange={(value) => {
            if (mode === "backtest") {
              onBacktestRiskCustomAnchorPriceChange(value);
              return;
            }
            onOptimizationConfigChange({
              ...optimizationConfig,
              custom_anchor_price: value
            });
          }}
          maxLossAnchorPrice={maxLossAnchorPrice}
          maxLossAnchorTime={maxLossAnchorTime}
          maxLossAnchorLoading={maxLossAnchorLoading}
          maxLossAnchorLabel={maxLossAnchorLabel}
          showMaxLossRequiredHint={mode === "optimize"}
        />
        {!hideRunButton || onSecondaryAction || onExport ? (
          <div
            className="sticky z-20 rounded-lg border border-slate-700/60 bg-slate-900/92 p-2 backdrop-blur"
            style={{
              bottom:
                "calc(env(safe-area-inset-bottom) + var(--mobile-bottom-sticky-offset, 0px) + 0.25rem)"
            }}
          >
            <div className={`grid gap-2 ${!hideRunButton && (onSecondaryAction || onExport) ? "grid-cols-2" : "grid-cols-1"}`}>
              {!hideRunButton && (
                <button
                  className="ui-btn ui-btn-primary w-full min-h-[44px]"
                  onClick={onRun}
                  disabled={loading || Boolean(runBlockedReason)}
                  type="button"
                  data-tour-id={mode === "backtest" ? "run-backtest-button" : "run-optimize-button"}
                >
                  {loading ? runningLabel : runLabel}
                </button>
              )}
              {onSecondaryAction && (
                <button
                  className="ui-btn ui-btn-secondary w-full min-h-[44px]"
                  onClick={onSecondaryAction}
                  disabled={secondaryActionDisabled}
                  type="button"
                >
                  {secondaryActionLabel}
                </button>
              )}
              {onExport && (
                <button
                  className="ui-btn ui-btn-secondary w-full min-h-[44px]"
                  onClick={onExport}
                  disabled={!canExport}
                  type="button"
                >
                  {exportLabel}
                </button>
              )}
            </div>
            {runBlockedReason && (
              <button
                type="button"
                className="mt-2 w-full rounded-md border border-slate-700/70 bg-slate-900/35 px-3 py-2 text-left text-xs text-slate-300"
                onClick={() => setMobileBlockedReasonSheetOpen(true)}
              >
                {mobileBlockedSummaryText}
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="card fade-up w-full p-3 sm:p-4">
      <div className="space-y-4">
        <div>
          <h1 className="text-base font-semibold text-slate-100 sm:text-lg">Crypto网格策略回测工具</h1>
        </div>

        {isMobileViewport && (
          <div className="ui-tab-group w-full">
            <button
              type="button"
              className={`ui-tab ${mode === "backtest" ? "is-active" : ""}`}
              onClick={() => onModeChange?.("backtest")}
              data-tour-id="parameter-mode-backtest-button"
            >
              回测参数
            </button>
            <button
              type="button"
              className={`ui-tab ${mode === "optimize" ? "is-active" : ""}`}
              onClick={() => onModeChange?.("optimize")}
              data-tour-id="parameter-mode-optimize-button"
            >
              优化参数
            </button>
          </div>
        )}

        <div>
          {isMobileViewport && mobileMinimalLayoutEnabled ? (
            <section className="space-y-3" data-tour-id="mobile-parameter-wizard">
              <section className="card-sub border border-slate-700/60 bg-slate-900/30 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">模板</p>
                    <p className="truncate text-sm font-semibold text-slate-100">{mobileTemplateSummaryName}</p>
                  </div>
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary ui-btn-xs"
                    onClick={() => setMobileTemplateSheetOpen(true)}
                  >
                    模板
                  </button>
                </div>
              </section>
              <div className="card-sub border border-slate-700/60 bg-slate-900/30 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold tracking-wide text-slate-200">
                    步骤 {wizardStepIndex + 1}/{wizardStepCount} · {mobileWizardStepLabel}
                  </p>
                  <p className="text-[11px] text-slate-400">未完成 {currentStepIncompleteCount}</p>
                </div>
                <div className="ui-progress-track mt-2 h-1.5">
                  <div
                    className="ui-progress-fill"
                    style={{ width: `${((wizardStepIndex + 1) / wizardStepCount) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  {WIZARD_STEP_META.map((meta, index) => {
                    const active = wizardStep === meta.key;
                    return (
                      <button
                        key={meta.key}
                        type="button"
                        className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                          active
                            ? "border-[color:rgba(var(--accent-rgb),0.72)] bg-[color:rgba(var(--accent-rgb),0.2)] text-slate-100"
                            : "border-slate-700/70 bg-slate-900/35 text-slate-300"
                        }`}
                        onClick={() => goToStep(meta.key)}
                        data-tour-id={`wizard-step-${index + 1}`}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                {mobileIncompleteTotal > 0 && (
                  <p className="mt-2 text-[11px] text-amber-200">总待处理 {mobileIncompleteTotal} 项</p>
                )}
              </div>
              {renderMobileWizardContent()}

              {wizardStep !== "risk_submit" && (
                <div
                  className="sticky grid grid-cols-2 gap-2 rounded-lg border border-slate-700/60 bg-slate-900/92 p-2 backdrop-blur"
                  style={{
                    bottom:
                      "calc(env(safe-area-inset-bottom) + var(--mobile-bottom-sticky-offset, 0px) + 0.25rem)"
                  }}
                >
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary w-full min-h-[44px]"
                    onClick={goPrev}
                    disabled={!canGoPrev}
                  >
                    上一步
                  </button>
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary w-full min-h-[44px]"
                    onClick={goNext}
                    disabled={!canGoNext}
                  >
                    下一步
                  </button>
                </div>
              )}
            </section>
          ) : mode === "backtest" ? (
            <BacktestSections
            request={request}
            updateStrategy={updateStrategy}
            updateData={updateData}
            marketParamsSyncing={marketParamsSyncing}
            marketParamsNote={marketParamsNote}
            onSyncMarketParams={onSyncMarketParams}
            riskAnchorMode={backtestRiskAnchorMode}
            onRiskAnchorModeChange={onBacktestRiskAnchorModeChange}
            riskCustomAnchorPrice={backtestRiskCustomAnchorPrice}
            onRiskCustomAnchorPriceChange={onBacktestRiskCustomAnchorPriceChange}
            maxLossAnchorPrice={maxLossAnchorPrice}
            maxLossAnchorTime={maxLossAnchorTime}
            maxLossAnchorLoading={maxLossAnchorLoading}
            maxLossAnchorLabel={maxLossAnchorLabel}
            startTimeInputValue={startTimeInputValue}
            endTimeInputValue={endTimeInputValue}
            useNowEndTime={useNowEndTime}
            beijingMinuteInputToIso={beijingMinuteInputToIso}
            nowBeijingIsoMinute={nowBeijingIsoMinute}
            isMobileViewport={isMobileViewport}
            mobileTab={mobileTab}
            onMobileTabChange={setMobileTab}
            mobileTabIncompleteCount={mobileTabIncompleteCount}
            mobileIncompleteTotal={mobileIncompleteTotal}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            selectedTemplateLocked={selectedTemplateLocked}
            importRef={importRef}
            onSelectedTemplateIdChange={setSelectedTemplateId}
            onSaveTemplate={handleSaveTemplate}
            onApplyTemplate={applyTemplate}
            onExportTemplate={exportTemplate}
            onDeleteTemplate={deleteTemplate}
            onImportTemplate={importTemplate}
            actions={actionButtons}
            />
          ) : (
            <OptimizationSections
            request={request}
            optimizationConfig={optimizationConfig}
            onOptimizationConfigChange={onOptimizationConfigChange}
            updateStrategy={updateStrategy}
            updateData={updateData}
            marketParamsSyncing={marketParamsSyncing}
            marketParamsNote={marketParamsNote}
            onSyncMarketParams={onSyncMarketParams}
            maxLossAnchorPrice={maxLossAnchorPrice}
            maxLossAnchorTime={maxLossAnchorTime}
            maxLossAnchorLoading={maxLossAnchorLoading}
            maxLossAnchorLabel={maxLossAnchorLabel}
            startTimeInputValue={startTimeInputValue}
            endTimeInputValue={endTimeInputValue}
            useNowEndTime={useNowEndTime}
            beijingMinuteInputToIso={beijingMinuteInputToIso}
            nowBeijingIsoMinute={nowBeijingIsoMinute}
            isMobileViewport={isMobileViewport}
            mobileTab={mobileTab}
            onMobileTabChange={setMobileTab}
            mobileTabIncompleteCount={mobileTabIncompleteCount}
            mobileIncompleteTotal={mobileIncompleteTotal}
            actions={actionButtons}
            />
          )}
        </div>
      </div>

      <InputDialog
        open={saveDialogOpen}
        title="模板名称"
        defaultValue={saveDialogDefaultName}
        placeholder="请输入模板名称"
        onCancel={() => setSaveDialogOpen(false)}
        onConfirm={handleConfirmSaveTemplate}
      />
      <MobileTemplateSheet
        open={isMobileViewport && mobileMinimalLayoutEnabled && mobileTemplateSheetOpen}
        title={mobileTemplateSheetMode === "strategy" ? "回测模版" : "优化模板"}
        onClose={() => setMobileTemplateSheetOpen(false)}
      >
        {mobileTemplateSheetMode === "strategy" ? (
          <StrategyTemplateSection
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            selectedTemplateLocked={selectedTemplateLocked}
            inputClassName={inputClass()}
            importRef={importRef}
            onSelectedTemplateIdChange={setSelectedTemplateId}
            onSaveTemplate={handleSaveTemplate}
            onApplyTemplate={applyTemplate}
            onExportTemplate={exportTemplate}
            onDeleteTemplate={deleteTemplate}
            onImportTemplate={importTemplate}
            compact
          />
        ) : (
          <OptimizationTemplateSection
            config={optimizationConfig}
            onChange={onOptimizationConfigChange}
            compact
            selectedTemplateId={mobileOptimizationTemplateId}
            onSelectedTemplateIdChange={setMobileOptimizationTemplateId}
            onSelectedTemplateNameChange={setMobileOptimizationTemplateName}
          />
        )}
      </MobileTemplateSheet>
      <MobileBlockedReasonSheet
        open={isMobileViewport && mobileMinimalLayoutEnabled && mobileBlockedReasonSheetOpen}
        reason={runBlockedReason}
        onClose={() => setMobileBlockedReasonSheetOpen(false)}
      />
    </aside>
  );
}
