import { describe, expect, it, vi } from "vitest";

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
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
    headers: new Headers()
  })
);

import { fetchLiveRobotList } from "./api";

describe("fetchLiveRobotList", () => {
  it("returns robot list items", async () => {
    const result = await fetchLiveRobotList({
      exchange: "okx",
      credentials: {
        api_key: "demo-key",
        api_secret: "demo-secret",
        passphrase: "demo-passphrase"
      }
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].algo_id).toBe("algo-123");
    expect(result.items[0].symbol).toBe("BTCUSDT");
  });
});
