import type { JSX } from "react";
import type { BacktestRequest, DataSource, Interval, StrategyConfig } from "../../lib/api-schema";

export type NumericFieldSpec = {
  key: keyof StrategyConfig;
  label: string;
  min?: number;
  step?: number;
  scale?: number;
};

export function labelClass(): string {
  return "mb-1 block text-xs uppercase tracking-wide text-slate-400";
}

export function inputClass(): string {
  return "ui-input min-w-0";
}

export function formatPercent(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

export const INTERVAL_OPTIONS: Array<{ value: Interval; label: string }> = [
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

export const DATA_SOURCE_OPTIONS: Array<{ value: DataSource; label: string }> = [
  { value: "binance", label: "Binance Futures API" },
  { value: "bybit", label: "Bybit API" },
  { value: "okx", label: "OKX API" }
];

export const SYMBOL_OPTIONS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT"] as const;

export const RANGE_FIELDS: NumericFieldSpec[] = [
  { key: "lower", label: "下边界" },
  { key: "upper", label: "上边界" },
  { key: "grids", label: "网格数", min: 2, step: 1 }
];

export const POSITION_FIELDS: NumericFieldSpec[] = [
  { key: "leverage", label: "杠杆倍数", min: 1, step: 0.1 },
  { key: "margin", label: "初始保证金 (USDT)", min: 1, step: 10 }
];

export const RISK_FIELDS: NumericFieldSpec[] = [
  { key: "stop_loss", label: "止损价格", min: 1 },
  { key: "maintenance_margin_rate", label: "维持保证金率 (%)", step: 0.1, scale: 100 },
  { key: "slippage", label: "滑点 (%)", step: 0.001, scale: 100 }
];

export function renderNumericFields(
  request: BacktestRequest,
  fields: NumericFieldSpec[],
  updateStrategy: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void
): JSX.Element[] {
  return fields.map((field) => {
    const raw = request.strategy[field.key];
    const numericValue = Number(raw ?? 0);
    const scale = field.scale ?? 1;
    const displayValue = Number.isFinite(numericValue) ? numericValue * scale : 0;
    return (
      <div key={String(field.key)}>
        <label className={labelClass()}>{field.label}</label>
        <input
          className={inputClass()}
          type="number"
          min={field.min}
          step={field.step}
          value={displayValue}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            updateStrategy(field.key, (parsed / scale) as StrategyConfig[typeof field.key]);
          }}
        />
      </div>
    );
  });
}
