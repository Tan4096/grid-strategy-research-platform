import { BacktestRequest, DataSource } from "../../types";
import { useState } from "react";
import {
  DATA_SOURCE_OPTIONS,
  formatNumber,
  formatPercent,
  inputClass,
  labelClass
} from "./shared";

interface Props {
  request: BacktestRequest;
  updateData: <K extends keyof BacktestRequest["data"]>(key: K, value: BacktestRequest["data"][K]) => void;
  marketParamsSyncing: boolean;
  marketParamsNote: string | null;
  onSyncMarketParams: () => void;
  showExchangeParamsPanel?: boolean;
  startTimeInputValue?: string;
  endTimeInputValue?: string;
  useNowEndTime?: boolean;
  beijingMinuteInputToIso?: (value: string) => string | null;
  nowBeijingIsoMinute?: () => string;
}

export default function TradingEnvironmentSection({
  request,
  updateData,
  marketParamsSyncing,
  marketParamsNote,
  onSyncMarketParams,
  showExchangeParamsPanel = true,
  startTimeInputValue,
  endTimeInputValue,
  useNowEndTime,
  beijingMinuteInputToIso,
  nowBeijingIsoMinute
}: Props) {
  const [exchangePanelOpen, setExchangePanelOpen] = useState(false);
  const makerFeeRate = request.strategy.maker_fee_rate ?? request.strategy.fee_rate;
  const takerFeeRate = request.strategy.taker_fee_rate ?? request.strategy.fee_rate;
  const fundingRate = request.strategy.funding_rate_per_8h ?? 0;
  const fundingHours = request.strategy.funding_interval_hours ?? 8;
  const priceRef = Math.max((request.strategy.lower + request.strategy.upper) / 2, 1e-9);
  const qtyStep = Math.max(request.strategy.quantity_step_size ?? 0, 0);
  const minNotional = Math.max(request.strategy.min_notional ?? 0, 0);
  const lev = Math.max(request.strategy.leverage ?? 1, 1);
  const grids = Math.max(request.strategy.grids ?? 1, 1);
  const margin = Math.max(request.strategy.margin ?? 0, 0);
  const perGridNotionalNow = (margin * lev) / grids;
  const perGridNotionalNext = (margin * (lev + 1)) / grids;
  const quantizedQtyNow =
    qtyStep > 0 ? Math.floor((perGridNotionalNow / priceRef) / qtyStep + 1e-12) * qtyStep : perGridNotionalNow / priceRef;
  const quantizedQtyNext =
    qtyStep > 0
      ? Math.floor((perGridNotionalNext / priceRef) / qtyStep + 1e-12) * qtyStep
      : perGridNotionalNext / priceRef;
  const leverageResolutionLimited =
    qtyStep > 0 && Math.abs(quantizedQtyNow - quantizedQtyNext) < Math.max(qtyStep * 1e-6, 1e-12);
  const gridSize = (request.strategy.upper - request.strategy.lower) / grids;
  const tickSize = Math.max(request.strategy.price_tick_size ?? 0, 0);
  const tickResolutionLimited = tickSize > 0 && gridSize <= tickSize;
  const orderBlockedByMinNotional = perGridNotionalNow < minNotional;
  const slippageMove = Math.abs((request.strategy.slippage ?? 0) * priceRef);
  const slippageLikelyRoundedAway = tickSize > 0 && slippageMove > 0 && slippageMove < tickSize;
  const stopRounded = tickSize > 0 ? Math.round(request.strategy.stop_loss / tickSize) * tickSize : request.strategy.stop_loss;
  const stopRoundedChanged = tickSize > 0 && Math.abs(stopRounded - request.strategy.stop_loss) > Math.max(tickSize * 1e-6, 1e-10);
  const showTimeRangeInputs =
    typeof startTimeInputValue === "string" &&
    typeof endTimeInputValue === "string" &&
    typeof useNowEndTime === "boolean" &&
    typeof beijingMinuteInputToIso === "function" &&
    typeof nowBeijingIsoMinute === "function";

  return (
    <section className="card-sub space-y-3 border border-slate-700/60 bg-slate-900/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">交易环境</p>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <label className={labelClass()}>交易源</label>
          <select
            className={inputClass()}
            value={request.data.source}
            onChange={(e) => updateData("source", e.target.value as DataSource)}
          >
            {DATA_SOURCE_OPTIONS.map((sourceOpt) => (
              <option key={sourceOpt.value} value={sourceOpt.value}>
                {sourceOpt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass()}>交易对(输入自动匹配)</label>
          <input
            className={inputClass()}
            type="text"
            value={request.data.symbol}
            placeholder="BTCUSDT"
            data-tour-id="symbol-input"
            onChange={(e) => updateData("symbol", e.target.value.toUpperCase())}
            onBlur={(e) => {
              const next = e.target.value.trim().toUpperCase();
              updateData("symbol", next || "BTCUSDT");
            }}
          />
        </div>
      </div>

      {showTimeRangeInputs && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <div className="min-w-0">
            <label className={labelClass()}>开始时间</label>
            <input
              className={`${inputClass()} ui-datetime-input`}
              type="datetime-local"
              step={60}
              value={startTimeInputValue}
              onChange={(event) => updateData("start_time", beijingMinuteInputToIso(event.target.value))}
            />
          </div>
          <div className="min-w-0">
            <label className={labelClass()}>结束时间</label>
            <div className="space-y-2">
              <input
                className={`${inputClass()} ui-datetime-input`}
                type="datetime-local"
                step={60}
                value={endTimeInputValue}
                onChange={(event) => updateData("end_time", beijingMinuteInputToIso(event.target.value))}
              />
              <label className="flex items-center gap-2 text-[11px] leading-tight text-slate-300">
                <input
                  type="checkbox"
                  checked={useNowEndTime}
                  data-tour-id="time-now-checkbox"
                  onChange={(event) => {
                    if (event.target.checked) {
                      updateData("end_time", null);
                      return;
                    }
                    updateData("end_time", nowBeijingIsoMinute());
                  }}
                />
                到最新时间
              </label>
            </div>
          </div>
        </div>
      )}

      {showExchangeParamsPanel && (
        <details
          className="card-sub border border-slate-700/60 bg-slate-900/40"
          open={exchangePanelOpen}
          onToggle={(event) => setExchangePanelOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer list-none p-3 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <span className="flex items-center justify-between">
              <span>交易所自动参数</span>
              <span className="text-[11px] text-slate-400">{exchangePanelOpen ? "收起" : "展开"}</span>
            </span>
          </summary>
          <div className="space-y-2 border-t border-slate-700/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">Maker/Taker/资金费率与精度由交易所同步</p>
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-xs disabled:opacity-50"
                onClick={onSyncMarketParams}
                disabled={marketParamsSyncing}
              >
                {marketParamsSyncing ? "同步中..." : "刷新交易所参数"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
              <div className="card-sub border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
                Maker: <span className="font-medium text-slate-100">{formatPercent(makerFeeRate, 3)}</span>
              </div>
              <div className="card-sub border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
                Taker: <span className="font-medium text-slate-100">{formatPercent(takerFeeRate, 3)}</span>
              </div>
              <div className="card-sub border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
                Funding/8h: <span className="font-medium text-slate-100">{formatPercent(fundingRate, 4)}</span>
              </div>
              <div className="card-sub border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
                Funding周期: <span className="font-medium text-slate-100">{fundingHours}h</span>
              </div>
              <div className="card-sub border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
                Tick: <span className="font-medium text-slate-100">{formatNumber(request.strategy.price_tick_size, 6)}</span>
              </div>
              <div className="card-sub border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
                Qty Step: <span className="font-medium text-slate-100">{formatNumber(request.strategy.quantity_step_size, 6)}</span>
              </div>
              <div className="card-sub col-span-2 border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
                Min Notional: <span className="font-medium text-slate-100">{formatNumber(request.strategy.min_notional, 4)} USDT</span>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              {marketParamsNote ?? "将根据交易所 API 自动同步 Maker/Taker 费率、资金费率与最小交易精度。"}
            </p>
            {(leverageResolutionLimited ||
              tickResolutionLimited ||
              orderBlockedByMinNotional ||
              slippageLikelyRoundedAway ||
              stopRoundedChanged) && (
              <div className="card-sub border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                {leverageResolutionLimited && (
                  <p>
                    当前 Qty Step 可能导致相邻杠杆（如 {lev.toFixed(2)} 倍 与 {(lev + 1).toFixed(2)} 倍）量化后同手数，回测差异会被弱化。
                  </p>
                )}
                {tickResolutionLimited && (
                  <p>
                    当前网格间距 ({gridSize.toFixed(6)}) 小于等于 Tick ({tickSize.toFixed(6)})，部分价格参数变化可能被同价位取整。
                  </p>
                )}
                {orderBlockedByMinNotional && (
                  <p>
                    当前单格名义价值 ({formatNumber(perGridNotionalNow, 4)} USDT) 小于 Min Notional (
                    {formatNumber(minNotional, 4)} USDT)，部分网格无法开仓，杠杆/保证金/网格数的影响会被抑制。
                  </p>
                )}
                {slippageLikelyRoundedAway && (
                  <p>
                    当前滑点折算价格变化约 {formatNumber(slippageMove, 6)}，小于 Tick ({formatNumber(tickSize, 6)})，滑点影响可能被价格取整吞掉。
                  </p>
                )}
                {stopRoundedChanged && (
                  <p>
                    止损价会按 Tick 取整为 {formatNumber(stopRounded, 6)}，止损参数的细微改动可能不反映在成交价中。
                  </p>
                )}
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
