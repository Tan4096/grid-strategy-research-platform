import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../lib/storage";
import type { LiveConnectionDraft, LiveRobotListItem } from "../types";
import LiveConnectionPanel from "./LiveConnectionPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountedNode {
  container: HTMLDivElement;
  unmount: () => void;
}

function mount(node: ReactNode): MountedNode {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}

const originalLocalStorage = window.localStorage;

const draft: LiveConnectionDraft = {
  algo_id: "algo-123",
  profiles: {
    binance: { api_key: "", api_secret: "", passphrase: "" },
    bybit: { api_key: "", api_secret: "", passphrase: "" },
    okx: { api_key: "key", api_secret: "secret", passphrase: "pass" }
  }
};

const robotItems: LiveRobotListItem[] = [
  {
    algo_id: "algo-123",
    name: "BTC Grid",
    symbol: "BTCUSDT",
    exchange_symbol: "BTC-USDT-SWAP",
    state: "running",
    side: "short",
    updated_at: "2026-03-07T10:56:35.773+08:00"
  }
];

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

describe("LiveConnectionPanel", () => {
  it("defaults credential editor to expanded and persists manual collapse", () => {
    const mounted = mount(
      <LiveConnectionPanel
        draft={draft}
        onChange={vi.fn()}
        persistCredentialsEnabled={false}
        onPersistCredentialsEnabledChange={vi.fn()}
        exchange="okx"
        symbol="BTCUSDT"
        strategyStartedAt="2026-03-01T00:00:00+08:00"
        loading={false}
        monitoringActive
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        error={null}
        robotItems={robotItems}
        robotListLoading={false}
        robotListError={null}
        selectedScope="running"
        onSelectedScopeChange={vi.fn()}
        pollIntervalSec={15}
        onPollIntervalChange={vi.fn()}
        selectedRobotMissing={false}
        onSelectRecentRobot={vi.fn()}
        onRefreshRobots={vi.fn()}
        onClearCredentials={vi.fn()}
        primaryBlockingReason={null}
      />
    );

    const text = mounted.container.textContent ?? "";
    expect(text).toContain("监测连接");
    expect(text).toContain("OKX 凭证");
    expect(text).toContain("在当前浏览器会话中保存 OKX 凭证");
    expect(text).toContain("共享设备请勿启用");
    expect(text).toContain("清空凭证");
    expect(text).toContain("收起凭证");
    expect(text).toContain("API Key");
    expect(text).toContain("监测对象 (algoId)");
    expect(text).toContain("请选择机器人");
    expect(text).toContain("完整 algoId：algo-123");

    const editButton = Array.from(mounted.container.querySelectorAll("button")).find((node) => node.textContent?.includes("收起凭证"));
    expect(editButton).not.toBeNull();
    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mounted.container.textContent ?? "").not.toContain("API Key");
    expect(window.localStorage.getItem(STORAGE_KEYS.liveConnectionCredentialsExpanded)).toBe("false");

    mounted.unmount();
  });

  it("lets the user choose algoId from robot list", () => {
    const onChange = vi.fn();
    const mounted = mount(
      <LiveConnectionPanel
        draft={draft}
        onChange={onChange}
        persistCredentialsEnabled={false}
        onPersistCredentialsEnabledChange={vi.fn()}
        exchange="okx"
        symbol="BTCUSDT"
        strategyStartedAt="2026-03-01T00:00:00+08:00"
        loading={false}
        monitoringActive={false}
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        error={null}
        robotItems={[
          ...robotItems,
          {
            algo_id: "algo-456",
            name: "ETH Grid",
            symbol: "ETHUSDT",
            exchange_symbol: "ETH-USDT-SWAP",
            state: "running",
            side: "long",
            updated_at: "2026-03-07T11:56:35.773+08:00"
          }
        ]}
        robotListLoading={false}
        robotListError={null}
        selectedScope="running"
        onSelectedScopeChange={vi.fn()}
        pollIntervalSec={15}
        onPollIntervalChange={vi.fn()}
        selectedRobotMissing={false}
        onSelectRecentRobot={vi.fn()}
        onRefreshRobots={vi.fn()}
        onClearCredentials={vi.fn()}
        primaryBlockingReason={null}
      />
    );

    const select = mounted.container.querySelector('select') as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    expect(select?.textContent ?? "").not.toContain("ETH Grid");
    expect(select?.textContent ?? "").toContain("BTCUSDT · 做空");
    act(() => {
      if (select) {
        select.value = 'algo-456';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(onChange).toHaveBeenCalled();
    mounted.unmount();
  });

  it("renders opt-in checkbox state and allows clearing credentials", () => {
    const onPersistChange = vi.fn();
    const onClear = vi.fn();
    const mounted = mount(
      <LiveConnectionPanel
        draft={draft}
        onChange={vi.fn()}
        persistCredentialsEnabled
        onPersistCredentialsEnabledChange={onPersistChange}
        exchange="okx"
        symbol="BTCUSDT"
        strategyStartedAt="2026-03-01T00:00:00+08:00"
        loading={false}
        monitoringActive={false}
        autoRefreshPaused={false}
        autoRefreshPausedReason={null}
        error={null}
        robotItems={robotItems}
        robotListLoading={false}
        robotListError={null}
        selectedScope="running"
        onSelectedScopeChange={vi.fn()}
        pollIntervalSec={15}
        onPollIntervalChange={vi.fn()}
        selectedRobotMissing={false}
        onSelectRecentRobot={vi.fn()}
        onRefreshRobots={vi.fn()}
        onClearCredentials={onClear}
        primaryBlockingReason={null}
      />
    );

    const checkbox = mounted.container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    expect(checkbox?.checked).toBe(true);

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPersistChange).toHaveBeenCalled();

    const clearButton = Array.from(mounted.container.querySelectorAll("button")).find((node) => node.textContent?.includes("清空凭证"));
    expect(clearButton).toBeTruthy();
    act(() => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);

    mounted.unmount();
  });
});
