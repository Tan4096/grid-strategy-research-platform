import { AnchorMode, BacktestRequest, StrategyConfig } from "../../types";
import {
  estimateInitialAverageEntryAndLiquidationPrice,
  estimateMaxPossibleLossAtStop
} from "../../lib/backtestAppHelpers";
import MaxLossSafetyHint from "../ui/MaxLossSafetyHint";
import { RISK_FIELDS, inputClass, labelClass, renderNumericFields } from "./shared";

const RISK_ANCHOR_OPTIONS: Array<{ value: AnchorMode; label: string }> = [
  { value: "BACKTEST_START_PRICE", label: "第一根K线收盘价" },
  { value: "BACKTEST_AVG_PRICE", label: "区间均价" },
  { value: "CURRENT_PRICE", label: "回测末端K线收盘价" },
  { value: "CUSTOM_PRICE", label: "自定义价格" }
];

interface Props {
  request: BacktestRequest;
  updateStrategy: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void;
  riskAnchorMode: AnchorMode;
  onRiskAnchorModeChange: (mode: AnchorMode) => void;
  riskCustomAnchorPrice: number | null;
  onRiskCustomAnchorPriceChange: (value: number | null) => void;
  maxLossAnchorPrice?: number | null;
  maxLossAnchorTime?: string | null;
  maxLossAnchorLoading?: boolean;
  maxLossAnchorLabel?: string;
  showMaxLossRequiredHint?: boolean;
}

export default function RiskSection({
  request,
  updateStrategy,
  riskAnchorMode,
  onRiskAnchorModeChange,
  riskCustomAnchorPrice,
  onRiskCustomAnchorPriceChange,
  maxLossAnchorPrice,
  maxLossAnchorTime,
  maxLossAnchorLoading = false,
  maxLossAnchorLabel = "第一根K线收盘价",
  showMaxLossRequiredHint = false
}: Props) {
  const estimatedLoss = estimateMaxPossibleLossAtStop(
    request.strategy,
    Number.isFinite(maxLossAnchorPrice) ? Number(maxLossAnchorPrice) : undefined
  );
  const { estimatedLiquidationPrice } = estimateInitialAverageEntryAndLiquidationPrice(
    request.strategy,
    Number.isFinite(maxLossAnchorPrice) ? Number(maxLossAnchorPrice) : undefined
  );
  const liqText = Number.isFinite(estimatedLiquidationPrice)
    ? Number(estimatedLiquidationPrice).toFixed(2)
    : "--";

  return (
    <section className="card-sub space-y-3 border border-slate-700/60 bg-slate-900/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">风险控制</p>
        <div className="rounded border border-slate-700/70 bg-slate-950/45 px-2 py-1 text-right">
          <p className="text-[10px] text-slate-400">预估强平价</p>
          <p className="text-xs font-semibold text-slate-200">{maxLossAnchorLoading ? "计算中..." : liqText}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {renderNumericFields(request, RISK_FIELDS, updateStrategy)}
        <div>
          <label className={labelClass()}>止损后重开</label>
          <select
            className={inputClass()}
            value={request.strategy.reopen_after_stop ? "true" : "false"}
            onChange={(e) => updateStrategy("reopen_after_stop", e.target.value === "true")}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        <div>
          <label className={labelClass()}>最大亏损数额 (USDT)</label>
          <input
            className={inputClass()}
            type="number"
            min={0}
            step={1}
            value={request.strategy.max_allowed_loss_usdt ?? ""}
            placeholder={showMaxLossRequiredHint ? "必填，触发止损的亏损上限" : undefined}
            data-tour-id="max-loss-input"
            onChange={(event) => {
              const raw = event.target.value.trim();
              updateStrategy(
                "max_allowed_loss_usdt",
                (raw === "" ? null : Number(raw)) as StrategyConfig["max_allowed_loss_usdt"]
              );
            }}
          />
        </div>
        <div>
          <label className={labelClass()}>Anchor 价格基准</label>
          <select
            className={inputClass()}
            value={riskAnchorMode}
            data-tour-id="risk-anchor-mode-select"
            onChange={(event) => onRiskAnchorModeChange(event.target.value as AnchorMode)}
          >
            {RISK_ANCHOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {riskAnchorMode === "CUSTOM_PRICE" && (
            <input
              className={`${inputClass()} mt-2`}
              type="number"
              min={0}
              step={0.01}
              value={riskCustomAnchorPrice ?? ""}
              placeholder="请输入自定义 Anchor 价格"
              onChange={(event) => {
                const raw = event.target.value.trim();
                onRiskCustomAnchorPriceChange(raw === "" ? null : Number(raw));
              }}
            />
          )}
        </div>
      </div>
      <MaxLossSafetyHint
        estimatedLoss={estimatedLoss}
        limit={request.strategy.max_allowed_loss_usdt}
        anchorPrice={maxLossAnchorPrice}
        anchorTime={maxLossAnchorTime}
        anchorLoading={maxLossAnchorLoading}
        anchorLabel={maxLossAnchorLabel}
      />
    </section>
  );
}
