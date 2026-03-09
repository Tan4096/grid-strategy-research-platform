import { useEffect, useMemo, useState } from "react";
import type { BacktestRequest, StrategyConfig } from "../../lib/api-schema";
import { useIsMobile } from "../../hooks/responsive/useIsMobile";

const BEIJING_TIME_ZONE = "Asia/Shanghai";
const MINUTE_MS = 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export type MobileParameterTab = "range" | "position" | "risk" | "env" | "time";

export const MOBILE_PARAMETER_TABS: Array<{ key: MobileParameterTab; label: string }> = [
  { key: "time", label: "时间" },
  { key: "range", label: "区间" },
  { key: "position", label: "仓位" },
  { key: "risk", label: "风控" },
  { key: "env", label: "交易环境" }
];

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidIsoTime(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

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

export function beijingMinuteInputToIso(value: string): string | null {
  if (!value) {
    return null;
  }
  return `${value}:00+08:00`;
}

export function nowBeijingIsoMinute(): string {
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

interface UseParameterFormStateParams {
  request: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
}

export interface ParameterFormState {
  isMobileViewport: boolean;
  mobileTab: MobileParameterTab;
  setMobileTab: (tab: MobileParameterTab) => void;
  mobileTabIncompleteCount: Record<MobileParameterTab, number>;
  mobileIncompleteTotal: number;
  updateStrategy: <K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) => void;
  updateData: <K extends keyof BacktestRequest["data"]>(key: K, value: BacktestRequest["data"][K]) => void;
  startTimeInputValue: string;
  endTimeInputValue: string;
  useNowEndTime: boolean;
  nowEndPreview: string;
}

export function useParameterFormState({
  request,
  onChange
}: UseParameterFormStateParams): ParameterFormState {
  const isMobileViewport = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileParameterTab>("range");
  const [nowEndPreview, setNowEndPreview] = useState<string>(() => nowBeijingIsoMinute());

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

  const useNowEndTime = !request.data.end_time;

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

  const mobileTabIncompleteCount = useMemo<Record<MobileParameterTab, number>>(() => {
    const counts: Record<MobileParameterTab, number> = {
      range: 0,
      position: 0,
      risk: 0,
      env: 0,
      time: 0
    };

    const strategy = request.strategy;
    const data = request.data;

    if (!isValidNumber(strategy.lower) || strategy.lower <= 0) {
      counts.range += 1;
    }
    if (!isValidNumber(strategy.upper) || strategy.upper <= 0) {
      counts.range += 1;
    }
    if (isValidNumber(strategy.lower) && isValidNumber(strategy.upper) && strategy.upper <= strategy.lower) {
      counts.range += 1;
    }
    if (!isValidNumber(strategy.grids) || strategy.grids < 2) {
      counts.range += 1;
    }

    if (!isValidNumber(strategy.leverage) || strategy.leverage < 1) {
      counts.position += 1;
    }
    if (!isValidNumber(strategy.margin) || strategy.margin <= 0) {
      counts.position += 1;
    }

    if (!isValidNumber(strategy.stop_loss) || strategy.stop_loss <= 0) {
      counts.risk += 1;
    }
    if (!isValidNumber(strategy.maintenance_margin_rate) || strategy.maintenance_margin_rate <= 0) {
      counts.risk += 1;
    }
    if (!isValidNumber(strategy.slippage) || strategy.slippage < 0) {
      counts.risk += 1;
    }

    if (!data.source) {
      counts.env += 1;
    }
    if (!String(data.symbol ?? "").trim()) {
      counts.env += 1;
    }

    const hasStartTime = isValidIsoTime(data.start_time ?? null);
    const hasEndTime = isValidIsoTime(data.end_time ?? null);
    if (!hasStartTime) {
      counts.time += 1;
    }
    if (Boolean(data.end_time) && !hasEndTime) {
      counts.time += 1;
    }
    if (hasStartTime && hasEndTime) {
      const startMs = new Date(data.start_time as string).getTime();
      const endMs = new Date(data.end_time as string).getTime();
      if (startMs >= endMs) {
        counts.time += 1;
      }
    }

    return counts;
  }, [request]);

  const mobileIncompleteTotal = useMemo(
    () => Object.values(mobileTabIncompleteCount).reduce((sum, value) => sum + value, 0),
    [mobileTabIncompleteCount]
  );

  const startTimeInputValue = isoToBeijingMinuteInput(request.data.start_time ?? null);
  const endTimeInputValue = isoToBeijingMinuteInput(useNowEndTime ? nowEndPreview : request.data.end_time ?? null);

  return {
    isMobileViewport,
    mobileTab,
    setMobileTab,
    mobileTabIncompleteCount,
    mobileIncompleteTotal,
    updateStrategy,
    updateData,
    startTimeInputValue,
    endTimeInputValue,
    useNowEndTime,
    nowEndPreview
  };
}
