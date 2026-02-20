import { BacktestRequest, DataSource } from "../../types";
import {
  DATA_SOURCE_OPTIONS,
  SYMBOL_OPTIONS,
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
}

export default function TradingEnvironmentSection({
  request,
  updateData,
  marketParamsSyncing,
  marketParamsNote,
  onSyncMarketParams
}: Props) {
  const normalizedSymbol = request.data.symbol.toUpperCase();
  const symbolOptions = SYMBOL_OPTIONS.includes(normalizedSymbol as (typeof SYMBOL_OPTIONS)[number])
    ? [...SYMBOL_OPTIONS]
    : [normalizedSymbol, ...SYMBOL_OPTIONS];
  const makerFeeRate = request.strategy.maker_fee_rate ?? request.strategy.fee_rate;
  const takerFeeRate = request.strategy.taker_fee_rate ?? request.strategy.fee_rate;
  const fundingRate = request.strategy.funding_rate_per_8h ?? 0;
  const fundingHours = request.strategy.funding_interval_hours ?? 8;
  const isCsvSource = request.data.source === "csv";

  return (
    <section className="space-y-3 rounded-md border border-slate-700/60 bg-slate-900/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">交易环境</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass()}>数据源</label>
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
          <label className={labelClass()}>交易对</label>
          <select
            className={inputClass()}
            value={request.data.symbol}
            onChange={(e) => updateData("symbol", e.target.value.toUpperCase())}
          >
            {symbolOptions.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-slate-700/60 bg-slate-900/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">交易所自动参数</p>
          <button
            type="button"
            className="rounded border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-50"
            onClick={onSyncMarketParams}
            disabled={isCsvSource || marketParamsSyncing}
          >
            {marketParamsSyncing ? "同步中..." : "刷新交易所参数"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
          <div className="rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            Maker: <span className="font-medium text-slate-100">{formatPercent(makerFeeRate, 3)}</span>
          </div>
          <div className="rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            Taker: <span className="font-medium text-slate-100">{formatPercent(takerFeeRate, 3)}</span>
          </div>
          <div className="rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            Funding/8h: <span className="font-medium text-slate-100">{formatPercent(fundingRate, 4)}</span>
          </div>
          <div className="rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            Funding周期: <span className="font-medium text-slate-100">{fundingHours}h</span>
          </div>
          <div className="rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            Tick: <span className="font-medium text-slate-100">{formatNumber(request.strategy.price_tick_size, 6)}</span>
          </div>
          <div className="rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            Qty Step: <span className="font-medium text-slate-100">{formatNumber(request.strategy.quantity_step_size, 6)}</span>
          </div>
          <div className="col-span-2 rounded border border-slate-700/60 bg-slate-950/60 px-2 py-1.5">
            Min Notional: <span className="font-medium text-slate-100">{formatNumber(request.strategy.min_notional, 4)} USDT</span>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {isCsvSource
            ? "CSV 数据源不提供交易所元数据。"
            : marketParamsNote ?? "将根据交易所 API 自动同步 Maker/Taker 费率、资金费率与最小交易精度。"}
        </p>
      </div>
    </section>
  );
}
