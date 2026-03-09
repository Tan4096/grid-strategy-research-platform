import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "../lib/storage";
import {
  LiveConnectionDraft,
  LiveCredentials,
  LiveExchange,
  LiveMonitoringPreference
} from "../types";

type MonitoringPreferenceMap = Record<string, LiveMonitoringPreference>;

const DEFAULT_MONITORING_PREFERENCE: LiveMonitoringPreference = {
  monitoring_enabled: false,
  poll_interval_sec: 15,
  selected_scope: "running"
};

function buildDefaultDraft(): LiveConnectionDraft {
  return {
    algo_id: "",
    profiles: {
      binance: { api_key: "", api_secret: "", passphrase: "" },
      bybit: { api_key: "", api_secret: "", passphrase: "" },
      okx: { api_key: "", api_secret: "", passphrase: "" }
    }
  };
}

function normalizeExchange(value: unknown): LiveExchange {
  return value === "bybit" || value === "okx" ? value : "binance";
}

function stripCredentials(draft: LiveConnectionDraft): LiveConnectionDraft {
  return {
    ...draft,
    profiles: {
      binance: { api_key: "", api_secret: "", passphrase: "" },
      bybit: { api_key: "", api_secret: "", passphrase: "" },
      okx: { api_key: "", api_secret: "", passphrase: "" }
    }
  };
}

function normalizeDraft(raw: unknown): LiveConnectionDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<LiveConnectionDraft>;
  const defaults = buildDefaultDraft();
  const rawProfiles =
    candidate.profiles && typeof candidate.profiles === "object"
      ? (candidate.profiles as Partial<Record<LiveExchange, Partial<LiveCredentials>>>)
      : null;

  if (rawProfiles) {
    return {
      algo_id: typeof candidate.algo_id === "string" ? candidate.algo_id.trim() : "",
      profiles: {
        binance: { ...defaults.profiles.binance, ...(rawProfiles.binance ?? {}) },
        bybit: { ...defaults.profiles.bybit, ...(rawProfiles.bybit ?? {}) },
        okx: { ...defaults.profiles.okx, ...(rawProfiles.okx ?? {}) }
      }
    };
  }

  const legacyExchange = normalizeExchange((candidate as { exchange?: unknown }).exchange);
  const credentials =
    (candidate as { credentials?: unknown }).credentials &&
    typeof (candidate as { credentials?: unknown }).credentials === "object"
      ? ((candidate as { credentials?: Partial<LiveCredentials> }).credentials ?? {})
      : {};
  const migrated = buildDefaultDraft();
  migrated.profiles[legacyExchange] = {
    api_key: typeof credentials.api_key === "string" ? credentials.api_key : "",
    api_secret: typeof credentials.api_secret === "string" ? credentials.api_secret : "",
    passphrase: typeof credentials.passphrase === "string" ? credentials.passphrase : ""
  };
  return migrated;
}

function normalizePollInterval(value: unknown): LiveMonitoringPreference["poll_interval_sec"] {
  return value === 5 || value === 15 || value === 30 || value === 60 ? value : 15;
}

function normalizeMonitoringPreference(raw: unknown): LiveMonitoringPreference {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MONITORING_PREFERENCE };
  }
  const candidate = raw as Partial<LiveMonitoringPreference>;
  return {
    monitoring_enabled: candidate.monitoring_enabled === true,
    poll_interval_sec: normalizePollInterval(candidate.poll_interval_sec),
    selected_scope: candidate.selected_scope === "recent" ? "recent" : "running"
  };
}

function normalizeMonitoringPreferenceMap(raw: unknown): MonitoringPreferenceMap {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: MonitoringPreferenceMap = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (!key.trim()) {
      return;
    }
    result[key] = normalizeMonitoringPreference(value);
  });
  return result;
}

function readDraft(): LiveConnectionDraft {
  if (typeof window === "undefined") {
    return buildDefaultDraft();
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.liveConnectionDraft);
    if (!raw) {
      return buildDefaultDraft();
    }
    const normalized = normalizeDraft(JSON.parse(raw));
    return normalized ?? buildDefaultDraft();
  } catch {
    return buildDefaultDraft();
  }
}

function readPersistCredentialsEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEYS.liveConnectionCredentialsPersistEnabled) === "1";
  } catch {
    return false;
  }
}

function readMonitoringPreferences(): MonitoringPreferenceMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.liveMonitoringPreferences);
    if (!raw) {
      return {};
    }
    return normalizeMonitoringPreferenceMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeDraft(value: LiveConnectionDraft): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.liveConnectionDraft, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function writePersistCredentialsEnabled(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      STORAGE_KEYS.liveConnectionCredentialsPersistEnabled,
      value ? "1" : "0"
    );
  } catch {
    // ignore storage failures
  }
}

function writeMonitoringPreferences(value: MonitoringPreferenceMap): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.liveMonitoringPreferences, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

interface Result {
  draft: LiveConnectionDraft;
  setDraft: Dispatch<SetStateAction<LiveConnectionDraft>>;
  ready: boolean;
  persistCredentialsEnabled: boolean;
  setPersistCredentialsEnabled: Dispatch<SetStateAction<boolean>>;
  clearCredentials: () => void;
  getMonitoringPreference: (key: string) => LiveMonitoringPreference;
  updateMonitoringPreference: (
    key: string,
    updater:
      | LiveMonitoringPreference
      | ((prev: LiveMonitoringPreference) => LiveMonitoringPreference)
  ) => void;
}

export function usePersistedLiveTradingConfig(): Result {
  const [draft, setDraft] = useState<LiveConnectionDraft>(buildDefaultDraft);
  const [monitoringPreferences, setMonitoringPreferences] = useState<MonitoringPreferenceMap>({});
  const [persistCredentialsEnabled, setPersistCredentialsEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const persistedDraft = readDraft();
    const persistEnabled = readPersistCredentialsEnabled();
    setPersistCredentialsEnabled(persistEnabled);
    setDraft(persistEnabled ? persistedDraft : stripCredentials(persistedDraft));
    setMonitoringPreferences(readMonitoringPreferences());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    writeDraft(persistCredentialsEnabled ? draft : stripCredentials(draft));
  }, [draft, persistCredentialsEnabled, ready]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    writePersistCredentialsEnabled(persistCredentialsEnabled);
  }, [persistCredentialsEnabled, ready]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    writeMonitoringPreferences(monitoringPreferences);
  }, [monitoringPreferences, ready]);

  const getMonitoringPreference = useCallback(
    (key: string) => monitoringPreferences[key] ?? { ...DEFAULT_MONITORING_PREFERENCE },
    [monitoringPreferences]
  );

  const updateMonitoringPreference = useCallback<Result["updateMonitoringPreference"]>((key, updater) => {
    if (!key.trim()) {
      return;
    }
    setMonitoringPreferences((prev) => {
      const current = prev[key] ?? { ...DEFAULT_MONITORING_PREFERENCE };
      const nextValue = typeof updater === "function" ? updater(current) : updater;
      return {
        ...prev,
        [key]: normalizeMonitoringPreference(nextValue)
      };
    });
  }, []);

  return {
    draft,
    setDraft,
    ready,
    persistCredentialsEnabled,
    setPersistCredentialsEnabled,
    clearCredentials: () => {
      setDraft(buildDefaultDraft());
    },
    getMonitoringPreference,
    updateMonitoringPreference
  };
}
