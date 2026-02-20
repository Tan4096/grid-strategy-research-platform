import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  DEFAULT_OPTIMIZATION_CONFIG,
  LEGACY_OPTIMIZATION_PARAMS_STORAGE_KEY,
  OPTIMIZATION_STORAGE_VERSION
} from "../lib/defaults";
import { STORAGE_KEYS, readVersioned, writeVersioned } from "../lib/storage";
import { OptimizationConfig, SweepRange } from "../types";

function mergeSweepRange(defaultSweep: SweepRange, candidateSweep: unknown): SweepRange {
  if (!candidateSweep || typeof candidateSweep !== "object") {
    return { ...defaultSweep };
  }
  return {
    ...defaultSweep,
    ...(candidateSweep as Partial<SweepRange>)
  };
}

function normalizeStoredOptimizationConfig(raw: unknown): OptimizationConfig | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<OptimizationConfig>;
  const merged: OptimizationConfig = {
    ...DEFAULT_OPTIMIZATION_CONFIG,
    ...candidate,
    leverage: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.leverage, candidate.leverage),
    grids: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.grids, candidate.grids),
    band_width_pct: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.band_width_pct, candidate.band_width_pct),
    stop_loss_ratio_pct: mergeSweepRange(DEFAULT_OPTIMIZATION_CONFIG.stop_loss_ratio_pct, candidate.stop_loss_ratio_pct)
  };
  if (!Number.isFinite(merged.max_trials) || merged.max_trials <= 0) {
    const legacy = Number(
      (candidate as Partial<OptimizationConfig>).max_combinations ?? DEFAULT_OPTIMIZATION_CONFIG.max_trials
    );
    merged.max_trials = Number.isFinite(legacy) && legacy > 0 ? legacy : DEFAULT_OPTIMIZATION_CONFIG.max_trials;
  }
  return merged;
}

function loadStoredOptimizationConfig(): OptimizationConfig | null {
  return readVersioned(
    STORAGE_KEYS.optimizationConfig,
    OPTIMIZATION_STORAGE_VERSION,
    normalizeStoredOptimizationConfig,
    [LEGACY_OPTIMIZATION_PARAMS_STORAGE_KEY]
  );
}

function saveOptimizationConfigToStorage(config: OptimizationConfig): void {
  writeVersioned(STORAGE_KEYS.optimizationConfig, OPTIMIZATION_STORAGE_VERSION, config);
}

interface UsePersistedOptimizationConfigResult {
  optimizationConfig: OptimizationConfig;
  setOptimizationConfig: Dispatch<SetStateAction<OptimizationConfig>>;
  optimizationConfigReady: boolean;
}

export function usePersistedOptimizationConfig(): UsePersistedOptimizationConfigResult {
  const [optimizationConfig, setOptimizationConfig] = useState<OptimizationConfig>(
    DEFAULT_OPTIMIZATION_CONFIG
  );
  const [optimizationConfigReady, setOptimizationConfigReady] = useState(false);

  useEffect(() => {
    const storedOptimizationConfig = loadStoredOptimizationConfig();
    if (storedOptimizationConfig) {
      setOptimizationConfig(storedOptimizationConfig);
    }
    setOptimizationConfigReady(true);
  }, []);

  useEffect(() => {
    if (!optimizationConfigReady) {
      return;
    }
    saveOptimizationConfigToStorage(optimizationConfig);
  }, [optimizationConfig, optimizationConfigReady]);

  return {
    optimizationConfig,
    setOptimizationConfig,
    optimizationConfigReady
  };
}
