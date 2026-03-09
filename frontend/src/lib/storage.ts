export const STORAGE_KEYS = {
  backtestRequest: "btc-grid-backtest:last-backtest-request:v2",
  optimizationConfig: "btc-grid-backtest:last-optimization-config:v2",
  optimizationControlSections: "btc-grid-backtest:optimization-control-sections:v1",
  optimizationResultsTableConfig: "btc-grid-backtest:optimization-results-table-config:v1",
  optimizationResultsColumnsConfig: "btc-grid-backtest:optimization-results-columns-config:v1",
  optimizationOperationLogs: "btc-grid-backtest:optimization-operation-logs:v1",
  operationFeedbackClearedAt: "btc-grid-backtest:operation-feedback-cleared-at:v1",
  operationCenterFilters: "operation_center_filters_v1",
  operationCenterUnread: "operation_center_unread_v1",
  optimizationHistoryCursor: "optimization_history_cursor_v1",
  mobilePrimaryTab: "btc-grid-backtest:mobile-primary-tab:v1",
  mobileParameterWizardStep: "btc-grid-backtest:mobile-parameter-wizard-step:v1",
  mobileOptimizeSubtab: "btc-grid-backtest:mobile-optimize-subtab:v1",
  mobileBacktestMetricsExpanded: "btc-grid-backtest:mobile-backtest-metrics-expanded:v1",
  mobileOptimizeAdvancedOpen: "btc-grid-backtest:mobile-optimize-advanced-open:v1",
  mobileBacktestViewV2: "btc-grid-backtest:mobile-backtest-view:v2",
  backtestRecordSortOrder: "btc-grid-backtest:backtest-record-sort-order:v1",
  backtestTradesViewMode: "btc-grid-backtest:backtest-trades-view-mode:v1",
  backtestEventsFilters: "btc-grid-backtest:backtest-events-filters:v1",
  backtestTradesSortOrder: "btc-grid-backtest:backtest-trades-sort-order:v1",
  backtestEventsSortOrder: "btc-grid-backtest:backtest-events-sort-order:v1",
  mobileOptimizeLandingViewV2: "btc-grid-backtest:mobile-optimize-landing-view:v2",
  mobileOptimizeSheetLast: "btc-grid-backtest:mobile-optimize-sheet:last:v1",
  mobileTemplateSheetLastMode: "btc-grid-backtest:mobile-template-sheet:last-mode:v1",
  mobileBottomReserved: "mobile_bottom_reserved_v1",
  liveConnectionDraft: "btc-grid-backtest:live-connection-draft:v1",
  liveConnectionCredentialsPersistEnabled: "btc-grid-backtest:live-connection-credentials-persist-enabled:v1",
  liveConnectionCredentialsExpanded: "btc-grid-backtest:live-connection-credentials-expanded:v1",
  liveMonitoringPreferences: "btc-grid-backtest:live-monitoring-preferences:v1",
  liveMonitoringTrendHistory: "btc-grid-backtest:live-monitoring-trend-history:v1",
  priceGridLegendSelection: "btc-grid-backtest:price-grid-legend-selection:v1",
  strategyTemplates: "btc-grid-backtest:strategy-templates:v2",
  optimizationTemplates: "btc-grid-backtest:optimization-templates:v2",
  themeSettings: "btc-grid-backtest:theme-settings:v1",
  themeDefaultSettings: "btc-grid-backtest:theme-default-settings:v1"
} as const;

interface VersionedPayload<T> {
  version: number;
  data: T;
}

function readRaw<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable storage and quota errors.
  }
}

export function readVersioned<T>(
  key: string,
  version: number,
  normalize: (value: unknown) => T | null,
  legacyKeys: string[] = []
): T | null {
  const payload = readRaw<VersionedPayload<unknown>>(key);
  if (payload && typeof payload === "object" && "version" in payload && "data" in payload) {
    if (payload.version === version) {
      const normalized = normalize(payload.data);
      if (normalized !== null) {
        return normalized;
      }
    }
  }

  for (const legacyKey of legacyKeys) {
    const legacy = readRaw<unknown>(legacyKey);
    const normalized = normalize(legacy);
    if (normalized !== null) {
      writeVersioned(key, version, normalized);
      return normalized;
    }
  }

  return null;
}

export function writeVersioned<T>(key: string, version: number, value: T): void {
  const payload: VersionedPayload<T> = {
    version,
    data: value
  };
  writeRaw(key, payload);
}

export function readPlain<T>(key: string, normalize: (value: unknown) => T | null, legacyKeys: string[] = []): T | null {
  const direct = normalize(readRaw<unknown>(key));
  if (direct !== null) {
    return direct;
  }
  for (const legacyKey of legacyKeys) {
    const legacy = normalize(readRaw<unknown>(legacyKey));
    if (legacy !== null) {
      writeRaw(key, legacy);
      return legacy;
    }
  }
  return null;
}

export function writePlain(key: string, value: unknown): void {
  writeRaw(key, value);
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // no-op
  }
}
