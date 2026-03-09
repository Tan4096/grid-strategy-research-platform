import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "../test-utils/renderHook";

vi.mock("../lib/api", () => ({
  ApiRequestError: class extends Error {
    status = 400;
  },
  fetchLiveRobotList: vi.fn().mockResolvedValue({
    scope: "running",
    items: [
      {
        algo_id: "algo-123",
        name: "BTC Grid",
        symbol: "BTCUSDT",
        exchange_symbol: "BTC-USDT-SWAP",
        state: "running",
        side: "long"
      }
    ]
  }),
  getApiErrorInfo: () => ({ message: "请求失败" })
}));

import { fetchLiveRobotList } from "../lib/api";
import { useLiveRobotList } from "./useLiveRobotList";

describe("useLiveRobotList", () => {
  it("auto-loads OKX robot list when credentials are ready", async () => {
    vi.mocked(fetchLiveRobotList).mockClear();
    const hook = renderHook(() =>
      useLiveRobotList({
        draft: {
          algo_id: "",
          profiles: {
            binance: { api_key: "", api_secret: "", passphrase: "" },
            bybit: { api_key: "", api_secret: "", passphrase: "" },
            okx: { api_key: "demo-key", api_secret: "demo-secret", passphrase: "demo-passphrase" }
          }
        },
        exchange: "okx",
        active: true,
        ready: true,
        scope: "running"
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchLiveRobotList).toHaveBeenCalledTimes(1);
    expect(hook.value.items).toHaveLength(1);
    expect(hook.value.items[0].algo_id).toBe("algo-123");
  });

  it("keeps loaded robot list when panel becomes inactive and active again", async () => {
    vi.mocked(fetchLiveRobotList).mockClear();
    let active = true;
    const hook = renderHook(() =>
      useLiveRobotList({
        draft: {
          algo_id: "",
          profiles: {
            binance: { api_key: "", api_secret: "", passphrase: "" },
            bybit: { api_key: "", api_secret: "", passphrase: "" },
            okx: { api_key: "demo-key", api_secret: "demo-secret", passphrase: "demo-passphrase" }
          }
        },
        exchange: "okx",
        active,
        ready: true,
        scope: "running"
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchLiveRobotList).toHaveBeenCalledTimes(1);
    expect(hook.value.items).toHaveLength(1);

    active = false;
    hook.rerender();
    expect(hook.value.items).toHaveLength(1);

    active = true;
    hook.rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchLiveRobotList).toHaveBeenCalledTimes(1);
    expect(hook.value.items).toHaveLength(1);
  });

  it("syncs robot-list failure state into notification center", async () => {
    const fetchMock = vi.mocked(fetchLiveRobotList);
    fetchMock.mockReset();
    fetchMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        scope: "running",
        items: [
          {
            algo_id: "algo-123",
            name: "BTC Grid",
            symbol: "BTCUSDT",
            exchange_symbol: "BTC-USDT-SWAP",
            state: "running",
            side: "long"
          }
        ]
      });

    const notifyCenter = vi.fn();
    const hook = renderHook(() =>
      useLiveRobotList({
        draft: {
          algo_id: "",
          profiles: {
            binance: { api_key: "", api_secret: "", passphrase: "" },
            bybit: { api_key: "", api_secret: "", passphrase: "" },
            okx: { api_key: "demo-key", api_secret: "demo-secret", passphrase: "demo-passphrase" }
          }
        },
        exchange: "okx",
        active: true,
        ready: true,
        scope: "running",
        notifyCenter
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(notifyCenter).toHaveBeenCalledWith(expect.objectContaining({ id: "live-sync:robot-list", kind: "state" }));
    expect((notifyCenter.mock.calls[0]?.[0]?.detail ?? "").split(" · ")).toHaveLength(3);

    await act(async () => {
      await hook.value.refresh();
    });

    expect(notifyCenter).toHaveBeenCalledWith(expect.objectContaining({ id: "live-sync:robot-list", dismiss: true }));
  });
});
