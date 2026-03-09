import { useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS, readPlain, writePlain } from "../../../lib/storage";
import {
  buildResultsColumnVisibility,
  OPTIMIZATION_RESULTS_COLUMN_LABEL,
  OptimizationResultsColumnKey
} from "../../OptimizationResultsTable";
import { useIsMobile } from "../../../hooks/responsive/useIsMobile";
import { OptimizationRow } from "../../../types";

export type OptimizationResultTab = "table" | "heatmap" | "curves" | "robustness";
export type TableViewMode = "table" | "cards";
export type TablePreset = "core" | "full";

interface TablePreferences {
  view_mode: TableViewMode;
  preset: TablePreset;
}

const DEFAULT_TABLE_PREFERENCES: TablePreferences = {
  view_mode: "table",
  preset: "core"
};

function normalizeTablePreferences(value: unknown): TablePreferences | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as Partial<TablePreferences>;
  const viewMode = payload.view_mode === "cards" ? "cards" : payload.view_mode === "table" ? "table" : null;
  const preset = payload.preset === "full" ? "full" : payload.preset === "core" ? "core" : null;
  if (!viewMode || !preset) {
    return null;
  }
  return {
    view_mode: viewMode,
    preset
  };
}

function normalizeColumnVisibility(
  value: unknown
): Partial<Record<OptimizationResultsColumnKey, boolean>> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const next: Partial<Record<OptimizationResultsColumnKey, boolean>> = {};
  let hasAny = false;
  (Object.keys(OPTIMIZATION_RESULTS_COLUMN_LABEL) as OptimizationResultsColumnKey[]).forEach((key) => {
    if (typeof raw[key] !== "boolean") {
      return;
    }
    next[key] = raw[key] as boolean;
    hasAny = true;
  });
  return hasAny ? next : null;
}

function readInitialTablePreferences(): TablePreferences {
  if (typeof window === "undefined") {
    return DEFAULT_TABLE_PREFERENCES;
  }
  return (
    readPlain<TablePreferences>(STORAGE_KEYS.optimizationResultsTableConfig, normalizeTablePreferences) ??
    DEFAULT_TABLE_PREFERENCES
  );
}

function readInitialColumnVisibility(
  preset: TablePreset
): Partial<Record<OptimizationResultsColumnKey, boolean>> {
  if (typeof window === "undefined") {
    return buildResultsColumnVisibility(preset);
  }
  return (
    readPlain<Partial<Record<OptimizationResultsColumnKey, boolean>>>(
      STORAGE_KEYS.optimizationResultsColumnsConfig,
      normalizeColumnVisibility
    ) ?? buildResultsColumnVisibility(preset)
  );
}

interface UseResultWorkspaceStateParams {
  optimizationResultTab: OptimizationResultTab;
}

interface ResultFilterOptions {
  showPassedOnly: boolean;
  showPositiveOnly: boolean;
  diagnosticMode: boolean;
}

export function filterOptimizationRows(
  rows: OptimizationRow[],
  { showPassedOnly, showPositiveOnly, diagnosticMode }: ResultFilterOptions
): OptimizationRow[] {
  if (diagnosticMode) {
    return rows;
  }
  let nextRows = rows;
  if (showPassedOnly) {
    nextRows = nextRows.filter((row) => row.passes_constraints);
  }
  if (showPositiveOnly) {
    nextRows = nextRows.filter((row) => row.total_return_usdt > 0);
  }
  return nextRows;
}

export interface ResultWorkspaceState {
  isMobile: boolean;
  showPassedOnly: boolean;
  setShowPassedOnly: (next: boolean) => void;
  showPositiveOnly: boolean;
  setShowPositiveOnly: (next: boolean) => void;
  diagnosticMode: boolean;
  setDiagnosticMode: (next: boolean) => void;
  tableViewMode: TableViewMode;
  tableViewPreference: TableViewMode;
  setTableViewPreference: (next: TableViewMode) => void;
  tablePreset: TablePreset;
  setTablePreset: (next: TablePreset) => void;
  columnVisibility: Partial<Record<OptimizationResultsColumnKey, boolean>>;
  setColumnVisibility: (next: Partial<Record<OptimizationResultsColumnKey, boolean>>) => void;
  applyColumnPreset: (preset: TablePreset) => void;
  toggleColumnVisibility: (key: OptimizationResultsColumnKey, checked: boolean) => void;
  curveHoverRatio: number | null;
  setCurveHoverRatio: (ratio: number | null) => void;
  columnKeys: OptimizationResultsColumnKey[];
}

export function useResultWorkspaceState({
  optimizationResultTab
}: UseResultWorkspaceStateParams): ResultWorkspaceState {
  const isMobile = useIsMobile();
  const [showPassedOnly, setShowPassedOnly] = useState(true);
  const [showPositiveOnly, setShowPositiveOnly] = useState(true);
  const [diagnosticMode, setDiagnosticMode] = useState(false);
  const initialTablePreferences = useMemo(() => readInitialTablePreferences(), []);
  const [tableViewPreference, setTableViewPreference] = useState<TableViewMode>(
    initialTablePreferences.view_mode
  );
  const [tablePreset, setTablePreset] = useState<TablePreset>(initialTablePreferences.preset);
  const [columnVisibility, setColumnVisibility] = useState<
    Partial<Record<OptimizationResultsColumnKey, boolean>>
  >(() => readInitialColumnVisibility(initialTablePreferences.preset));
  const [curveHoverRatio, setCurveHoverRatio] = useState<number | null>(null);

  const tableViewMode: TableViewMode = isMobile ? "cards" : tableViewPreference;

  useEffect(() => {
    writePlain(STORAGE_KEYS.optimizationResultsTableConfig, {
      view_mode: tableViewPreference,
      preset: tablePreset
    } satisfies TablePreferences);
  }, [tablePreset, tableViewPreference]);

  useEffect(() => {
    writePlain(STORAGE_KEYS.optimizationResultsColumnsConfig, columnVisibility);
  }, [columnVisibility]);

  useEffect(() => {
    if (optimizationResultTab !== "curves") {
      setCurveHoverRatio(null);
    }
  }, [optimizationResultTab]);

  const applyColumnPreset = (preset: TablePreset) => {
    setTablePreset(preset);
    setColumnVisibility(buildResultsColumnVisibility(preset));
  };

  const toggleColumnVisibility = (key: OptimizationResultsColumnKey, checked: boolean) => {
    setColumnVisibility((prev) => {
      const next = {
        ...prev,
        [key]: checked
      };
      next.actions = true;
      return next;
    });
  };

  const columnKeys = useMemo(
    () => Object.keys(OPTIMIZATION_RESULTS_COLUMN_LABEL) as OptimizationResultsColumnKey[],
    []
  );

  return {
    isMobile,
    showPassedOnly,
    setShowPassedOnly,
    showPositiveOnly,
    setShowPositiveOnly,
    diagnosticMode,
    setDiagnosticMode,
    tableViewMode,
    tableViewPreference,
    setTableViewPreference,
    tablePreset,
    setTablePreset,
    columnVisibility,
    setColumnVisibility,
    applyColumnPreset,
    toggleColumnVisibility,
    curveHoverRatio,
    setCurveHoverRatio,
    columnKeys
  };
}
