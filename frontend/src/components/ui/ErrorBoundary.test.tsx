import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
});

interface MountedNode {
  container: HTMLDivElement;
  rerender: (node: ReactNode) => void;
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

function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <div>ok</div>;
}

describe("ErrorBoundary", () => {
  it("resets when resetKey changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mounted = mount(
      <ErrorBoundary fallbackMessage="fallback" resetKey="a">
        <Thrower shouldThrow />
      </ErrorBoundary>
    );

    expect(mounted.container.textContent).toContain("fallback");

    mounted.rerender(
      <ErrorBoundary fallbackMessage="fallback" resetKey="b">
        <Thrower shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(mounted.container.textContent).toContain("ok");
    mounted.unmount();
  });
});
