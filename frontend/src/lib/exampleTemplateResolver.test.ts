import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_OPTIMIZATION_CONFIG, FALLBACK_DEFAULTS } from "./defaults";
import {
  OPTIMIZATION_TEMP_TEMPLATE_ID,
  STRATEGY_TEMP_TEMPLATE_ID,
  persistLastRunOptimizationTemplate,
  persistLastRunStrategyTemplate,
  resolveOptimizationTemplates,
  resolveOptimizationExampleTemplate,
  resolveStrategyTemplates,
  resolveStrategyExampleTemplate
} from "./exampleTemplateResolver";
import { STORAGE_KEYS } from "./storage";

const originalLocalStorage = window.localStorage;

describe("exampleTemplateResolver", () => {
  beforeEach(() => {
    const memory = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => (memory.has(key) ? memory.get(key) ?? null : null),
        setItem: (key: string, value: string) => {
          memory.set(key, String(value));
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
        clear: () => {
          memory.clear();
        }
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  });

  it("rebuilds strategy example template when missing", () => {
    const example = resolveStrategyExampleTemplate(FALLBACK_DEFAULTS);
    expect(example.id).toBe("example-template");
    expect(example.name).toBe("示例模板");

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.strategyTemplates) ?? "[]") as Array<{
      id: string;
    }>;
    expect(stored[stored.length - 2]?.id).toBe(STRATEGY_TEMP_TEMPLATE_ID);
    expect(stored[stored.length - 1]?.id).toBe("example-template");
  });

  it("uses latest strategy example template value from storage", () => {
    const custom = {
      ...FALLBACK_DEFAULTS,
      data: {
        ...FALLBACK_DEFAULTS.data,
        symbol: "ETHUSDT"
      }
    };
    window.localStorage.setItem(
      STORAGE_KEYS.strategyTemplates,
      JSON.stringify([
        {
          id: "example-template",
          name: "旧名称",
          request: custom
        }
      ])
    );

    const example = resolveStrategyExampleTemplate(FALLBACK_DEFAULTS);
    expect(example.request.data.symbol).toBe("ETHUSDT");
    expect(example.name).toBe("示例模板");
  });

  it("rebuilds optimization example template when missing or invalid", () => {
    window.localStorage.setItem(
      STORAGE_KEYS.optimizationTemplates,
      JSON.stringify([{ id: "broken", name: "坏模板" }])
    );

    const example = resolveOptimizationExampleTemplate(DEFAULT_OPTIMIZATION_CONFIG);
    expect(example.id).toBe("optimization-example-template");
    expect(example.name).toBe("示例模板");
    expect(example.config.optimization_mode).toBe(DEFAULT_OPTIMIZATION_CONFIG.optimization_mode);
  });

  it("keeps temp optimization template first and example template last", () => {
    const customA = {
      ...DEFAULT_OPTIMIZATION_CONFIG,
      max_trials: 111
    };
    const customB = {
      ...DEFAULT_OPTIMIZATION_CONFIG,
      max_trials: 222
    };
    window.localStorage.setItem(
      STORAGE_KEYS.optimizationTemplates,
      JSON.stringify([
        {
          id: "optimization-example-template",
          name: "旧示例名",
          config: DEFAULT_OPTIMIZATION_CONFIG
        },
        {
          id: "newest",
          name: "最新模板",
          config: customA
        },
        {
          id: "older",
          name: "旧模板",
          config: customB
        }
      ])
    );

    const templates = resolveOptimizationTemplates(DEFAULT_OPTIMIZATION_CONFIG);
    expect(templates[0]?.id).toBe(OPTIMIZATION_TEMP_TEMPLATE_ID);
    expect(templates[1]?.id).toBe("newest");
    expect(templates[2]?.id).toBe("older");
    expect(templates[templates.length - 1]?.id).toBe("optimization-example-template");

    const example = resolveOptimizationExampleTemplate(DEFAULT_OPTIMIZATION_CONFIG);
    expect(example.id).toBe("optimization-example-template");
    expect(example.name).toBe("示例模板");
  });

  it("keeps temp strategy template first and example template last", () => {
    const customA = {
      ...FALLBACK_DEFAULTS,
      data: {
        ...FALLBACK_DEFAULTS.data,
        symbol: "ETHUSDT"
      }
    };
    const customB = {
      ...FALLBACK_DEFAULTS,
      data: {
        ...FALLBACK_DEFAULTS.data,
        symbol: "SOLUSDT"
      }
    };
    window.localStorage.setItem(
      STORAGE_KEYS.strategyTemplates,
      JSON.stringify([
        {
          id: "example-template",
          name: "旧示例名",
          request: FALLBACK_DEFAULTS
        },
        {
          id: "newest-strategy",
          name: "最新回测模板",
          request: customA
        },
        {
          id: "older-strategy",
          name: "旧回测模板",
          request: customB
        }
      ])
    );

    const templates = resolveStrategyTemplates(FALLBACK_DEFAULTS);
    expect(templates[0]?.id).toBe(STRATEGY_TEMP_TEMPLATE_ID);
    expect(templates[1]?.id).toBe("newest-strategy");
    expect(templates[2]?.id).toBe("older-strategy");
    expect(templates[templates.length - 1]?.id).toBe("example-template");

    const example = resolveStrategyExampleTemplate(FALLBACK_DEFAULTS);
    expect(example.id).toBe("example-template");
    expect(example.name).toBe("示例模板");
  });

  it("updates strategy temp template with latest run payload", () => {
    const first = {
      ...FALLBACK_DEFAULTS,
      data: { ...FALLBACK_DEFAULTS.data, symbol: "BTCUSDT" }
    };
    const second = {
      ...FALLBACK_DEFAULTS,
      data: { ...FALLBACK_DEFAULTS.data, symbol: "DOGEUSDT" }
    };

    persistLastRunStrategyTemplate(first);
    persistLastRunStrategyTemplate(second);

    const templates = resolveStrategyTemplates(FALLBACK_DEFAULTS);
    const temp = templates.find((item) => item.id === STRATEGY_TEMP_TEMPLATE_ID);
    expect(temp?.name).toBe("最近保存");
    expect(temp?.request.data.symbol).toBe("DOGEUSDT");
  });

  it("updates optimization temp template with latest run payload", () => {
    const first = { ...DEFAULT_OPTIMIZATION_CONFIG, max_trials: 123 };
    const second = { ...DEFAULT_OPTIMIZATION_CONFIG, max_trials: 456 };

    persistLastRunOptimizationTemplate(first);
    persistLastRunOptimizationTemplate(second);

    const templates = resolveOptimizationTemplates(DEFAULT_OPTIMIZATION_CONFIG);
    const temp = templates.find((item) => item.id === OPTIMIZATION_TEMP_TEMPLATE_ID);
    expect(temp?.name).toBe("最近保存");
    expect(temp?.config.max_trials).toBe(456);
  });
});
