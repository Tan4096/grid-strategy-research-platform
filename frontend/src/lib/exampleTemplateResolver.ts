import { OptimizationConfig, BacktestRequest } from "../types";
import { readPlain, STORAGE_KEYS, writePlain } from "./storage";

const LEGACY_STRATEGY_TEMPLATES_KEY = "btc-grid-backtest:strategy-templates:v1";
const LEGACY_OPTIMIZATION_TEMPLATES_KEY = "btc-grid-backtest:optimization-templates:v1";
const EXAMPLE_TEMPLATE_NAME = "示例模板";
const TEMP_TEMPLATE_NAME = "最近保存";

export const STRATEGY_EXAMPLE_TEMPLATE_ID = "example-template";
export const OPTIMIZATION_EXAMPLE_TEMPLATE_ID = "optimization-example-template";
export const STRATEGY_TEMP_TEMPLATE_ID = "strategy-temp-template";
export const OPTIMIZATION_TEMP_TEMPLATE_ID = "optimization-temp-template";

export interface StrategyTemplate {
  id: string;
  name: string;
  request: BacktestRequest;
}

export interface OptimizationTemplate {
  id: string;
  name: string;
  config: OptimizationConfig;
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cloneRequest(request: BacktestRequest): BacktestRequest {
  return {
    strategy: { ...request.strategy },
    data: { ...request.data }
  };
}

function normalizeStrategyRequest(raw: unknown, fallback: BacktestRequest): BacktestRequest | null {
  if (!isRecord(raw) || !isRecord(raw.strategy) || !isRecord(raw.data)) {
    return null;
  }
  return {
    strategy: {
      ...fallback.strategy,
      ...(raw.strategy as Partial<BacktestRequest["strategy"]>)
    },
    data: {
      ...fallback.data,
      ...(raw.data as Partial<BacktestRequest["data"]>),
      
    }
  };
}

function normalizeOptimizationConfig(raw: unknown, fallback: OptimizationConfig): OptimizationConfig | null {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    ...fallback,
    ...(raw as Partial<OptimizationConfig>)
  };
}

function loadStrategyTemplateCandidates(): unknown[] {
  return (
    readPlain<unknown[]>(
      STORAGE_KEYS.strategyTemplates,
      (raw) => (Array.isArray(raw) ? raw : []),
      [LEGACY_STRATEGY_TEMPLATES_KEY]
    ) ?? []
  );
}

function loadOptimizationTemplateCandidates(): unknown[] {
  return (
    readPlain<unknown[]>(
      STORAGE_KEYS.optimizationTemplates,
      (raw) => (Array.isArray(raw) ? raw : []),
      [LEGACY_OPTIMIZATION_TEMPLATES_KEY]
    ) ?? []
  );
}

export function resolveStrategyTemplates(requestFallback: BacktestRequest): StrategyTemplate[] {
  const fallback = cloneRequest(requestFallback);
  const rawTemplates = loadStrategyTemplateCandidates();
  const usedIds = new Set<string>();
  const normalized: StrategyTemplate[] = [];

  for (const item of rawTemplates) {
    if (!isRecord(item)) {
      continue;
    }
    const request = normalizeStrategyRequest(item.request, fallback);
    if (!request) {
      continue;
    }
    const idCandidate = typeof item.id === "string" && item.id.trim() ? item.id.trim() : randomId();
    const id = usedIds.has(idCandidate) ? randomId() : idCandidate;
    usedIds.add(id);
    normalized.push({
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "未命名模板",
      request: cloneRequest(request)
    });
  }

  const example = normalized.find((item) => item.id === STRATEGY_EXAMPLE_TEMPLATE_ID);
  const temp = normalized.find((item) => item.id === STRATEGY_TEMP_TEMPLATE_ID);
  const customTemplates = normalized.filter(
    (item) => item.id !== STRATEGY_EXAMPLE_TEMPLATE_ID && item.id !== STRATEGY_TEMP_TEMPLATE_ID
  );
  const ensuredTemp: StrategyTemplate =
    temp ??
    {
      id: STRATEGY_TEMP_TEMPLATE_ID,
      name: TEMP_TEMPLATE_NAME,
      request: fallback
    };
  const ensuredExample: StrategyTemplate =
    example ??
    {
      id: STRATEGY_EXAMPLE_TEMPLATE_ID,
      name: EXAMPLE_TEMPLATE_NAME,
      request: fallback
    };

  const result = [
    {
      ...ensuredTemp,
      id: STRATEGY_TEMP_TEMPLATE_ID,
      name: TEMP_TEMPLATE_NAME,
      request: cloneRequest(ensuredTemp.request)
    },
    ...customTemplates,
    {
      ...ensuredExample,
      id: STRATEGY_EXAMPLE_TEMPLATE_ID,
      name: EXAMPLE_TEMPLATE_NAME,
      request: cloneRequest(ensuredExample.request)
    }
  ];
  writePlain(STORAGE_KEYS.strategyTemplates, result);
  return result;
}

export function resolveOptimizationTemplates(configFallback: OptimizationConfig): OptimizationTemplate[] {
  const rawTemplates = loadOptimizationTemplateCandidates();
  const usedIds = new Set<string>();
  const normalized: OptimizationTemplate[] = [];

  for (const item of rawTemplates) {
    if (!isRecord(item)) {
      continue;
    }
    const config = normalizeOptimizationConfig(item.config, configFallback);
    if (!config) {
      continue;
    }
    const idCandidate = typeof item.id === "string" && item.id.trim() ? item.id.trim() : randomId();
    const id = usedIds.has(idCandidate) ? randomId() : idCandidate;
    usedIds.add(id);
    normalized.push({
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "未命名模板",
      config: { ...config }
    });
  }

  const example = normalized.find((item) => item.id === OPTIMIZATION_EXAMPLE_TEMPLATE_ID);
  const temp = normalized.find((item) => item.id === OPTIMIZATION_TEMP_TEMPLATE_ID);
  const customTemplates = normalized.filter(
    (item) => item.id !== OPTIMIZATION_EXAMPLE_TEMPLATE_ID && item.id !== OPTIMIZATION_TEMP_TEMPLATE_ID
  );
  const ensuredTemp: OptimizationTemplate =
    temp ??
    {
      id: OPTIMIZATION_TEMP_TEMPLATE_ID,
      name: TEMP_TEMPLATE_NAME,
      config: { ...configFallback }
    };
  const ensuredExample: OptimizationTemplate =
    example ??
    {
      id: OPTIMIZATION_EXAMPLE_TEMPLATE_ID,
      name: EXAMPLE_TEMPLATE_NAME,
      config: { ...configFallback }
    };

  const result = [
    {
      ...ensuredTemp,
      id: OPTIMIZATION_TEMP_TEMPLATE_ID,
      name: TEMP_TEMPLATE_NAME,
      config: { ...ensuredTemp.config }
    },
    ...customTemplates,
    {
      ...ensuredExample,
      id: OPTIMIZATION_EXAMPLE_TEMPLATE_ID,
      name: EXAMPLE_TEMPLATE_NAME,
      config: { ...ensuredExample.config }
    }
  ];
  writePlain(STORAGE_KEYS.optimizationTemplates, result);
  return result;
}

export function resolveStrategyExampleTemplate(requestFallback: BacktestRequest): StrategyTemplate {
  const templates = resolveStrategyTemplates(requestFallback);
  return templates.find((item) => item.id === STRATEGY_EXAMPLE_TEMPLATE_ID) ?? templates[0];
}

export function resolveOptimizationExampleTemplate(
  configFallback: OptimizationConfig
): OptimizationTemplate {
  const templates = resolveOptimizationTemplates(configFallback);
  return templates.find((item) => item.id === OPTIMIZATION_EXAMPLE_TEMPLATE_ID) ?? templates[0];
}

export function persistLastRunStrategyTemplate(request: BacktestRequest): void {
  const templates = resolveStrategyTemplates(request);
  const nextRequest = cloneRequest(request);
  const next = templates.map((item) =>
    item.id === STRATEGY_TEMP_TEMPLATE_ID
      ? {
          ...item,
          id: STRATEGY_TEMP_TEMPLATE_ID,
          name: TEMP_TEMPLATE_NAME,
          request: nextRequest
        }
      : item
  );
  writePlain(STORAGE_KEYS.strategyTemplates, next);
}

export function persistLastRunOptimizationTemplate(config: OptimizationConfig): void {
  const templates = resolveOptimizationTemplates(config);
  const next = templates.map((item) =>
    item.id === OPTIMIZATION_TEMP_TEMPLATE_ID
      ? {
          ...item,
          id: OPTIMIZATION_TEMP_TEMPLATE_ID,
          name: TEMP_TEMPLATE_NAME,
          config: { ...config }
        }
      : item
  );
  writePlain(STORAGE_KEYS.optimizationTemplates, next);
}
