import { ChangeEvent, useEffect, useState } from "react";
import { BacktestRequest, DataSource, GridSide, Interval, StrategyConfig } from "../types";

interface Props {
  request: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
  onCsvLoaded: (filename: string, content: string) => void;
  onRun: () => void;
  loading: boolean;
  csvFileName: string | null;
  runLabel?: string;
  runningLabel?: string;
}

function labelClass() {
  return "mb-1 block text-xs uppercase tracking-wide text-slate-400";
}

function inputClass() {
  return "w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400";
}

const INTERVAL_OPTIONS: Array<{ value: Interval; label: string }> = [
  { value: "1m", label: "1m" },
  { value: "3m", label: "3m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1H" },
  { value: "2h", label: "2H" },
  { value: "4h", label: "4H" },
  { value: "6h", label: "6H" },
  { value: "8h", label: "8H" },
  { value: "12h", label: "12H" },
  { value: "1d", label: "1D" }
];

const DATA_SOURCE_OPTIONS: Array<{ value: DataSource; label: string }> = [
  { value: "binance", label: "Binance Futures API" },
  { value: "bybit", label: "Bybit API" },
  { value: "okx", label: "OKX API" },
  { value: "csv", label: "CSV 上传" }
];

const SYMBOL_OPTIONS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"] as const;

const BEIJING_TIME_ZONE = "Asia/Shanghai";
const MINUTE_MS = 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function isoToBeijingMinuteInput(isoValue?: string | null): string {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function beijingMinuteInputToIso(value: string): string | null {
  if (!value) {
    return null;
  }
  return `${value}:00+08:00`;
}

function nowBeijingIsoMinute(): string {
  const roundedUnixMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const beijingMs = roundedUnixMs + BEIJING_OFFSET_MS;
  const beijingDate = new Date(beijingMs);

  const y = beijingDate.getUTCFullYear();
  const m = String(beijingDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(beijingDate.getUTCDate()).padStart(2, "0");
  const h = String(beijingDate.getUTCHours()).padStart(2, "0");
  const minute = String(beijingDate.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${minute}:00+08:00`;
}

export default function ParameterForm({
  request,
  onChange,
  onCsvLoaded,
  onRun,
  loading,
  csvFileName,
  runLabel = "开始回测",
  runningLabel = "回测中..."
}: Props) {
  const updateStrategy = <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => {
    onChange({
      ...request,
      strategy: {
        ...request.strategy,
        [key]: value
      }
    });
  };

  const updateData = <K extends keyof BacktestRequest["data"]>(key: K, value: BacktestRequest["data"][K]) => {
    onChange({
      ...request,
      data: {
        ...request.data,
        [key]: value
      }
    });
  };

  const handleCsvUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const content = await file.text();
    onCsvLoaded(file.name, content);
  };

  const startTimeInputValue = isoToBeijingMinuteInput(request.data.start_time ?? null);
  const useNowEndTime = !request.data.end_time;
  const [nowEndPreview, setNowEndPreview] = useState<string>(() => nowBeijingIsoMinute());

  useEffect(() => {
    if (!useNowEndTime) {
      return;
    }

    const refresh = () => {
      setNowEndPreview(nowBeijingIsoMinute());
    };

    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [useNowEndTime]);

  const endTimeInputValue = isoToBeijingMinuteInput(
    useNowEndTime ? nowEndPreview : request.data.end_time ?? null
  );
  const normalizedSymbol = request.data.symbol.toUpperCase();
  const symbolOptions = SYMBOL_OPTIONS.includes(normalizedSymbol as (typeof SYMBOL_OPTIONS)[number])
    ? [...SYMBOL_OPTIONS]
    : [normalizedSymbol, ...SYMBOL_OPTIONS];

  return (
    <aside className="card fade-up w-full space-y-4 p-4 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Crypto永续网格回测工具</h1>
        <p className="mt-1 text-xs text-slate-400">参数可调 · 逐K线模拟 · 风险可视化</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass()}>方向</label>
          <select
            className={inputClass()}
            value={request.strategy.side}
            onChange={(e) => updateStrategy("side", e.target.value as GridSide)}
          >
            <option value="long">做多网格</option>
            <option value="short">做空网格</option>
          </select>
        </div>

        <div>
          <label className={labelClass()}>周期</label>
          <select
            className={inputClass()}
            value={request.data.interval}
            onChange={(e) => updateData("interval", e.target.value as Interval)}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass()}>LOWER</label>
          <input
            className={inputClass()}
            type="number"
            value={request.strategy.lower}
            onChange={(e) => updateStrategy("lower", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelClass()}>UPPER</label>
          <input
            className={inputClass()}
            type="number"
            value={request.strategy.upper}
            onChange={(e) => updateStrategy("upper", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelClass()}>GRIDS</label>
          <input
            className={inputClass()}
            type="number"
            min={2}
            value={request.strategy.grids}
            onChange={(e) => updateStrategy("grids", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelClass()}>LEVERAGE</label>
          <input
            className={inputClass()}
            type="number"
            min={1}
            step={0.1}
            value={request.strategy.leverage}
            onChange={(e) => updateStrategy("leverage", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelClass()}>MARGIN (USDT)</label>
          <input
            className={inputClass()}
            type="number"
            min={1}
            step={10}
            value={request.strategy.margin}
            onChange={(e) => updateStrategy("margin", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelClass()}>STOP_LOSS</label>
          <input
            className={inputClass()}
            type="number"
            min={1}
            value={request.strategy.stop_loss}
            onChange={(e) => updateStrategy("stop_loss", Number(e.target.value))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass()}>手续费率 (%)</label>
          <input
            className={inputClass()}
            type="number"
            step={0.001}
            value={request.strategy.fee_rate * 100}
            onChange={(e) => updateStrategy("fee_rate", Number(e.target.value) / 100)}
          />
        </div>
        <div>
          <label className={labelClass()}>滑点 (%)</label>
          <input
            className={inputClass()}
            type="number"
            step={0.001}
            value={request.strategy.slippage * 100}
            onChange={(e) => updateStrategy("slippage", Number(e.target.value) / 100)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass()}>开底仓</label>
          <label className="flex h-[42px] items-center gap-2 rounded-md border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={request.strategy.use_base_position}
              onChange={(e) => updateStrategy("use_base_position", e.target.checked)}
            />
            启用
          </label>
        </div>
        <div>
          <label className={labelClass()}>维持保证金率 (%)</label>
          <input
            className={inputClass()}
            type="number"
            step={0.1}
            value={request.strategy.maintenance_margin_rate * 100}
            onChange={(e) => updateStrategy("maintenance_margin_rate", Number(e.target.value) / 100)}
          />
        </div>
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

      <div className="space-y-3 border-t border-slate-700/60 pt-3">
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass()}>开始时间 (UTC+8)</label>
            <input
              className={inputClass()}
              type="datetime-local"
              step={60}
              value={startTimeInputValue}
              onChange={(e) => updateData("start_time", beijingMinuteInputToIso(e.target.value))}
            />
          </div>
          <div>
            <label className={labelClass()}>结束时间 (UTC+8)</label>
            <div className="space-y-2">
              <input
                className={inputClass()}
                type="datetime-local"
                step={60}
                value={endTimeInputValue}
                disabled={useNowEndTime}
                onChange={(e) => updateData("end_time", beijingMinuteInputToIso(e.target.value))}
              />
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={useNowEndTime}
                  onChange={(e) => {
                    if (e.target.checked) {
                      updateData("end_time", null);
                      return;
                    }
                    updateData("end_time", nowBeijingIsoMinute());
                  }}
                />
                到 Now（当前北京时间，精确到分钟）
              </label>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400">默认时间基准为北京时间 (UTC+8)，可勾选“到 Now”自动使用当前分钟。</p>

        <div>
          <label className={labelClass()}>CSV 文件（可选）</label>
          <input className={inputClass()} type="file" accept=".csv" onChange={handleCsvUpload} />
          <p className="mt-1 text-xs text-slate-400">
            {csvFileName ? `已选择: ${csvFileName}` : "支持列名: timestamp/open/high/low/close/volume"}
          </p>
        </div>
      </div>

      <button
        className="w-full rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onRun}
        disabled={loading}
        type="button"
      >
        {loading ? runningLabel : runLabel}
      </button>
    </aside>
  );
}
