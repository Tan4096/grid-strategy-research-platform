import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import LineChart from "./LineChart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountedComponent {
  container: HTMLDivElement;
  rerender: (node: ReactNode) => void;
  unmount: () => void;
}

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = globalThis.ResizeObserver;

function mount(node: ReactNode): MountedComponent {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    rerender: (nextNode: ReactNode) => {
      act(() => {
        root.render(nextNode);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: originalResizeObserver
  });
});

describe("LineChart", () => {
  it("renders start and end markers beside the y-axis", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: undefined
    });

    const mounted = mount(
      <LineChart
        title="测试曲线"
        color="#22c55e"
        yAxisLabel="USDT"
        data={[
          { timestamp: "2026-03-01T00:00:00Z", value: 100 },
          { timestamp: "2026-03-01T01:00:00Z", value: 120 },
          { timestamp: "2026-03-01T02:00:00Z", value: 80 }
        ]}
      />
    );

    expect(mounted.container.textContent).toContain("起 100.000");
    expect(mounted.container.textContent).toContain("终 80.000");

    mounted.unmount();
  });

  it("does not crash when data toggles between populated and empty", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: undefined
    });

    const mounted = mount(
      <LineChart
        title="测试曲线"
        color="#22c55e"
        yAxisLabel="USDT"
        data={[
          { timestamp: "2026-03-01T00:00:00Z", value: 100 },
          { timestamp: "2026-03-01T01:00:00Z", value: 120 }
        ]}
      />
    );

    mounted.rerender(
      <LineChart
        title="测试曲线"
        color="#22c55e"
        yAxisLabel="USDT"
        data={[]}
      />
    );
    expect(mounted.container.textContent).toContain("暂无曲线数据");

    mounted.rerender(
      <LineChart
        title="测试曲线"
        color="#22c55e"
        yAxisLabel="USDT"
        data={[
          { timestamp: "2026-03-01T02:00:00Z", value: 90 },
          { timestamp: "2026-03-01T03:00:00Z", value: 110 }
        ]}
      />
    );
    expect(mounted.container.textContent).toContain("当前:");

    mounted.unmount();
  });

  it("renders gradient area fill when area mode is enabled", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: undefined
    });

    const mounted = mount(
      <LineChart
        title="测试曲线"
        color="#84cc16"
        yAxisLabel="收益率"
        area
        data={[
          { timestamp: "2026-03-01T00:00:00Z", value: 1 },
          { timestamp: "2026-03-01T01:00:00Z", value: 2 }
        ]}
      />
    );

    expect(mounted.container.innerHTML).toContain("linearGradient");
    expect(mounted.container.innerHTML).toContain("url(#");

    mounted.unmount();
  });

  it("updates return-rate curve color based on hovered return amount", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: undefined
    });

    const mounted = mount(
      <LineChart
        title="测试收益率曲线"
        color="#94a3b8"
        yAxisLabel="收益率"
        returnAmountBase={100}
        area
        data={[
          { timestamp: "2026-03-01T00:00:00Z", value: -2 },
          { timestamp: "2026-03-01T01:00:00Z", value: 3 }
        ]}
      />
    );

    const svg = mounted.container.querySelector("svg");
    expect(svg).not.toBeNull();
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 920,
        height: 300,
        top: 0,
        left: 0,
        right: 920,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => undefined
      })
    });

    const linePath = () => mounted.container.querySelector('path[fill="none"]');
    const zeroAxisLine = () => mounted.container.querySelector('line[stroke-dasharray="6 4"]');

    expect(linePath()?.getAttribute("stroke")).toBe("#22c55e");
    expect(zeroAxisLine()).not.toBeNull();

    act(() => {
      svg?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 80, clientY: 220 }));
    });

    expect(linePath()?.getAttribute("stroke")).toBe("#ef4444");
    expect(mounted.container.textContent).toContain("收益额:");
    expect(mounted.container.textContent).toContain("-2.00 USDT");

    act(() => {
      svg?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 900, clientY: 40 }));
    });

    expect(linePath()?.getAttribute("stroke")).toBe("#22c55e");
    expect(mounted.container.textContent).toContain("3.00 USDT");

    mounted.unmount();
  });
});
