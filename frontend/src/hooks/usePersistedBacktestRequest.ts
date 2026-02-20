import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { fetchDefaults } from "../lib/api";
import {
  BACKTEST_STORAGE_VERSION,
  FALLBACK_DEFAULTS,
  LEGACY_BACKTEST_PARAMS_STORAGE_KEY
} from "../lib/defaults";
import { STORAGE_KEYS, readVersioned, writeVersioned } from "../lib/storage";
import { BacktestRequest } from "../types";

function normalizeStoredRequest(raw: unknown): BacktestRequest | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<BacktestRequest>;
  if (!candidate.strategy || !candidate.data) {
    return null;
  }

  return {
    strategy: {
      ...FALLBACK_DEFAULTS.strategy,
      ...candidate.strategy
    },
    data: {
      ...FALLBACK_DEFAULTS.data,
      ...candidate.data,
      // Never restore raw CSV payload from local storage.
      csv_content: null
    }
  };
}

function loadStoredBacktestRequest(): BacktestRequest | null {
  return readVersioned(
    STORAGE_KEYS.backtestRequest,
    BACKTEST_STORAGE_VERSION,
    normalizeStoredRequest,
    [LEGACY_BACKTEST_PARAMS_STORAGE_KEY]
  );
}

function saveBacktestRequestToStorage(request: BacktestRequest): void {
  const safeRequest: BacktestRequest = {
    strategy: { ...request.strategy },
    data: {
      ...request.data,
      // Avoid restoring CSV mode without file content in a new session.
      source: request.data.source === "csv" ? "binance" : request.data.source,
      csv_content: null
    }
  };
  writeVersioned(STORAGE_KEYS.backtestRequest, BACKTEST_STORAGE_VERSION, safeRequest);
}

interface UsePersistedBacktestRequestResult {
  request: BacktestRequest;
  setRequest: Dispatch<SetStateAction<BacktestRequest>>;
  requestReady: boolean;
}

export function usePersistedBacktestRequest(): UsePersistedBacktestRequestResult {
  const [request, setRequest] = useState<BacktestRequest>(FALLBACK_DEFAULTS);
  const [requestReady, setRequestReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const stored = loadStoredBacktestRequest();
    if (stored) {
      if (mounted) {
        setRequest(stored);
        setRequestReady(true);
      }
      return () => {
        mounted = false;
      };
    }

    fetchDefaults()
      .then((defaults) => {
        if (mounted) {
          setRequest(defaults);
        }
      })
      .catch(() => {
        // Keep fallback defaults when backend is not yet running.
      })
      .finally(() => {
        if (mounted) {
          setRequestReady(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!requestReady) {
      return;
    }
    saveBacktestRequestToStorage(request);
  }, [request, requestReady]);

  return {
    request,
    setRequest,
    requestReady
  };
}
