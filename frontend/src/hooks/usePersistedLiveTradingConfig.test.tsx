import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../lib/storage";
import { renderHook } from "../test-utils/renderHook";
import { usePersistedLiveTradingConfig } from "./usePersistedLiveTradingConfig";

const originalSessionStorage = window.sessionStorage;

beforeEach(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, "sessionStorage", {
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
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: originalSessionStorage
  });
});

describe("usePersistedLiveTradingConfig", () => {
  it("does not restore credentials unless persistence was explicitly enabled", async () => {
    window.sessionStorage.setItem(
      STORAGE_KEYS.liveConnectionDraft,
      JSON.stringify({
        algo_id: "algo-123",
        profiles: {
          binance: { api_key: "", api_secret: "", passphrase: "" },
          bybit: { api_key: "", api_secret: "", passphrase: "" },
          okx: { api_key: "demo-key", api_secret: "demo-secret", passphrase: "demo-pass" }
        }
      })
    );

    const hook = renderHook(() => usePersistedLiveTradingConfig());

    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.value.persistCredentialsEnabled).toBe(false);
    expect(hook.value.draft.algo_id).toBe("algo-123");
    expect(hook.value.draft.profiles.okx.api_key).toBe("");
    expect(hook.value.draft.profiles.okx.api_secret).toBe("");
    expect(hook.value.draft.profiles.okx.passphrase).toBe("");

    hook.unmount();
  });


  it("persists selected algoId even when credentials are not persisted", async () => {
    const hook = renderHook(() => usePersistedLiveTradingConfig());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      hook.value.setDraft((prev) => ({
        ...prev,
        algo_id: "algo-789",
        profiles: {
          ...prev.profiles,
          okx: {
            api_key: "demo-key",
            api_secret: "demo-secret",
            passphrase: "demo-pass"
          }
        }
      }));
      hook.value.setPersistCredentialsEnabled(false);
    });

    hook.rerender();
    hook.unmount();

    const remounted = renderHook(() => usePersistedLiveTradingConfig());
    await act(async () => {
      await Promise.resolve();
    });

    expect(remounted.value.draft.algo_id).toBe("algo-789");
    expect(remounted.value.draft.profiles.okx.api_key).toBe("");
    expect(remounted.value.draft.profiles.okx.api_secret).toBe("");
    expect(remounted.value.draft.profiles.okx.passphrase).toBe("");

    remounted.unmount();
  });

  it("restores credentials after explicit opt-in and persists within the same browser session", async () => {
    const hook = renderHook(() => usePersistedLiveTradingConfig());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      hook.value.setDraft((prev) => ({
        ...prev,
        algo_id: "algo-123",
        profiles: {
          ...prev.profiles,
          okx: {
            api_key: "demo-key",
            api_secret: "demo-secret",
            passphrase: "demo-pass"
          }
        }
      }));
      hook.value.setPersistCredentialsEnabled(true);
    });

    hook.rerender();
    hook.unmount();

    const remounted = renderHook(() => usePersistedLiveTradingConfig());
    await act(async () => {
      await Promise.resolve();
    });

    expect(remounted.value.persistCredentialsEnabled).toBe(true);
    expect(remounted.value.draft.algo_id).toBe("algo-123");
    expect(remounted.value.draft.profiles.okx.api_key).toBe("demo-key");
    expect(remounted.value.draft.profiles.okx.api_secret).toBe("demo-secret");
    expect(remounted.value.draft.profiles.okx.passphrase).toBe("demo-pass");

    remounted.unmount();
  });
});
