import { ChangeEvent, useEffect, useRef, useState } from "react";
import { STORAGE_KEYS, readPlain, writePlain } from "../lib/storage";
import { BacktestRequest, OptimizationConfig, StrategyConfig } from "../types";
import DataImportSection from "./parameter/DataImportSection";
import OptimizationTemplateSection from "./parameter/OptimizationTemplateSection";
import PositionSection from "./parameter/PositionSection";
import RangeSection from "./parameter/RangeSection";
import RiskSection from "./parameter/RiskSection";
import StrategyTemplateSection from "./parameter/StrategyTemplateSection";
import TimeRangeSection from "./parameter/TimeRangeSection";
import TradingEnvironmentSection from "./parameter/TradingEnvironmentSection";
import { inputClass } from "./parameter/shared";

interface Props {
  mode: "backtest" | "optimize";
  request: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
  optimizationConfig: OptimizationConfig;
  onOptimizationConfigChange: (next: OptimizationConfig) => void;
  onCsvLoaded: (filename: string, content: string) => void;
  onRun: () => void;
  loading: boolean;
  csvFileName: string | null;
  marketParamsSyncing: boolean;
  marketParamsNote: string | null;
  onSyncMarketParams: () => void;
  runLabel?: string;
  runningLabel?: string;
  hideRunButton?: boolean;
}

const BEIJING_TIME_ZONE = "Asia/Shanghai";
const MINUTE_MS = 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const LEGACY_STRATEGY_TEMPLATES_KEY = "btc-grid-backtest:strategy-templates:v1";

interface StrategyTemplate {
  id: string;
  name: string;
  request: BacktestRequest;
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

function loadStrategyTemplates(): StrategyTemplate[] {
  return (
    readPlain<StrategyTemplate[]>(
      STORAGE_KEYS.strategyTemplates,
      (raw) => {
        if (!Array.isArray(raw)) {
          return [];
        }
        return raw.filter(
          (item) => item && typeof item === "object" && "id" in item && "name" in item && "request" in item
        ) as StrategyTemplate[];
      },
      [LEGACY_STRATEGY_TEMPLATES_KEY]
    ) ?? []
  );
}

function saveStrategyTemplates(templates: StrategyTemplate[]) {
  writePlain(STORAGE_KEYS.strategyTemplates, templates);
}

export default function ParameterForm({
  mode,
  request,
  onChange,
  optimizationConfig,
  onOptimizationConfigChange,
  onCsvLoaded,
  onRun,
  loading,
  csvFileName,
  marketParamsSyncing,
  marketParamsNote,
  onSyncMarketParams,
  runLabel = "开始回测",
  runningLabel = "回测中...",
  hideRunButton = false
}: Props) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [templates, setTemplates] = useState<StrategyTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  useEffect(() => {
    const loaded = loadStrategyTemplates();
    setTemplates(loaded);
    if (loaded.length > 0) {
      setSelectedTemplateId(loaded[0].id);
    }
  }, []);

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

  const updateTemplates = (next: StrategyTemplate[]) => {
    setTemplates(next);
    saveStrategyTemplates(next);
    if (next.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    if (!next.some((item) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(next[0].id);
    }
  };

  const handleSaveTemplate = () => {
    const name = window.prompt("模板名称", request.data.symbol || "我的模板");
    if (!name || !name.trim()) {
      return;
    }
    const template: StrategyTemplate = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: name.trim(),
      request: {
        strategy: { ...request.strategy },
        data: {
          ...request.data,
          csv_content: null
        }
      }
    };
    updateTemplates([template, ...templates]);
    setSelectedTemplateId(template.id);
  };

  const handleApplyTemplate = () => {
    const selected = templates.find((item) => item.id === selectedTemplateId);
    if (!selected) {
      return;
    }
    onChange({
      strategy: { ...selected.request.strategy },
      data: {
        ...selected.request.data,
        csv_content: null
      }
    });
  };

  const handleDeleteTemplate = () => {
    if (!selectedTemplateId) {
      return;
    }
    updateTemplates(templates.filter((item) => item.id !== selectedTemplateId));
  };

  const handleExportTemplate = () => {
    const selected = templates.find((item) => item.id === selectedTemplateId);
    const payload = selected ?? templates;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    link.setAttribute("href", url);
    link.setAttribute("download", `grid-template-${ts}.json`);
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplate = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as unknown;
      const normalized: StrategyTemplate[] = [];
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object" && "name" in item && "request" in item) {
            normalized.push({
              id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              name: String((item as { name: unknown }).name || "导入模板"),
              request: (item as { request: BacktestRequest }).request
            });
          }
        });
      } else if (parsed && typeof parsed === "object" && "strategy" in parsed && "data" in parsed) {
        normalized.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          name: "导入模板",
          request: parsed as BacktestRequest
        });
      }
      if (normalized.length === 0) {
        return;
      }
      updateTemplates([...normalized, ...templates]);
      setSelectedTemplateId(normalized[0].id);
    } catch {
      // ignore malformed json
    } finally {
      event.target.value = "";
    }
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

  return (
    <aside className="card fade-up w-full space-y-4 p-4 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Crypto永续网格回测工具</h1>
        <p className="mt-1 text-xs text-slate-400">参数可调 · 逐K线模拟 · 风险可视化</p>
      </div>

      {!hideRunButton && (
        <button
          className="w-full rounded-md border border-slate-500 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onRun}
          disabled={loading}
          type="button"
        >
          {loading ? runningLabel : runLabel}
        </button>
      )}

      {mode === "backtest" ? (
        <StrategyTemplateSection
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          inputClassName={inputClass()}
          importRef={importRef}
          onSelectedTemplateIdChange={setSelectedTemplateId}
          onSaveTemplate={handleSaveTemplate}
          onApplyTemplate={handleApplyTemplate}
          onExportTemplate={handleExportTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onImportTemplate={handleImportTemplate}
        />
      ) : (
        <OptimizationTemplateSection config={optimizationConfig} onChange={onOptimizationConfigChange} />
      )}

      <RangeSection request={request} updateStrategy={updateStrategy} updateData={updateData} />
      <PositionSection request={request} updateStrategy={updateStrategy} />
      <RiskSection request={request} updateStrategy={updateStrategy} />
      <TradingEnvironmentSection
        request={request}
        updateData={updateData}
        marketParamsSyncing={marketParamsSyncing}
        marketParamsNote={marketParamsNote}
        onSyncMarketParams={onSyncMarketParams}
      />
      <TimeRangeSection
        startTimeInputValue={startTimeInputValue}
        endTimeInputValue={endTimeInputValue}
        useNowEndTime={useNowEndTime}
        updateData={updateData}
        beijingMinuteInputToIso={beijingMinuteInputToIso}
        nowBeijingIsoMinute={nowBeijingIsoMinute}
      />
      <DataImportSection csvFileName={csvFileName} onCsvUpload={handleCsvUpload} />
    </aside>
  );
}
