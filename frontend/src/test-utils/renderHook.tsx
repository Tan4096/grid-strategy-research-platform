import { act } from "react";
import { createRoot, Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface HookHandle<TValue> {
  readonly value: TValue;
  rerender: () => void;
  unmount: () => void;
}

export function renderHook<TValue>(hook: () => TValue): HookHandle<TValue> {
  let currentValue!: TValue;
  function Harness() {
    currentValue = hook();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const render = () => {
    act(() => {
      root.render(<Harness />);
    });
  };

  render();

  return {
    get value() {
      return currentValue;
    },
    rerender() {
      render();
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}
