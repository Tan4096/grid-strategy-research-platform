export const STORAGE_KEYS = {
  backtestRequest: "btc-grid-backtest:last-backtest-request:v2",
  optimizationConfig: "btc-grid-backtest:last-optimization-config:v2",
  onboardingDismissed: "btc-grid-backtest:onboarding-dismissed:v1",
  strategyTemplates: "btc-grid-backtest:strategy-templates:v2",
  optimizationTemplates: "btc-grid-backtest:optimization-templates:v2"
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
      return normalize(payload.data);
    }
  }

  for (const legacyKey of legacyKeys) {
    const legacy = readRaw<unknown>(legacyKey);
    const normalized = normalize(legacy);
    if (normalized) {
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
  if (direct) {
    return direct;
  }
  for (const legacyKey of legacyKeys) {
    const legacy = normalize(readRaw<unknown>(legacyKey));
    if (legacy) {
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
