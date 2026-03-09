import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OptimizationRow } from "../../../lib/api-schema";
import { renderHook } from "../../../test-utils/renderHook";
import {
  filterOptimizationRows,
  useResultWorkspaceState
} from "./useResultWorkspaceState";

const originalLocalStorage = window.localStorage;

function makeRow(partial: Partial<OptimizationRow>): OptimizationRow {
  return {
    row_id: partial.row_id ?? 1,
    leverage: partial.leverage ?? 3,
    grids: partial.grids ?? 8,
    use_base_position: partial.use_base_position ?? false,
    base_grid_count: partial.base_grid_count ?? 0,
    initial_position_size: partial.initial_position_size ?? 0,
    anchor_price: partial.anchor_price ?? 100,
    lower_price: partial.lower_price ?? 90,
    upper_price: partial.upper_price ?? 110,
    stop_price: partial.stop_price ?? 85,
    band_width_pct: partial.band_width_pct ?? 20,
    range_lower: partial.range_lower ?? 90,
    range_upper: partial.range_upper ?? 110,
    stop_loss: partial.stop_loss ?? 85,
    stop_loss_ratio_pct: partial.stop_loss_ratio_pct ?? 5,
    max_possible_loss_usdt: partial.max_possible_loss_usdt ?? 30,
    total_return_usdt: partial.total_return_usdt ?? 10,
    max_drawdown_pct: partial.max_drawdown_pct ?? 12,
    sharpe_ratio: partial.sharpe_ratio ?? 1,
    win_rate: partial.win_rate ?? 0.5,
    return_drawdown_ratio: partial.return_drawdown_ratio ?? 1,
    score: partial.score ?? 1,
    validation_total_return_usdt: partial.validation_total_return_usdt ?? 8,
    validation_max_drawdown_pct: partial.validation_max_drawdown_pct ?? 10,
    validation_sharpe_ratio: partial.validation_sharpe_ratio ?? 0.8,
    validation_win_rate: partial.validation_win_rate ?? 0.45,
    validation_return_drawdown_ratio: partial.validation_return_drawdown_ratio ?? 0.9,
    validation_score: partial.validation_score ?? 0.9,
    validation_total_closed_trades: partial.validation_total_closed_trades ?? 10,
    robust_score: partial.robust_score ?? 0.9,
    overfit_penalty: partial.overfit_penalty ?? 0.1,
    passes_constraints: partial.passes_constraints ?? true,
    constraint_violations: partial.constraint_violations ?? [],
    total_closed_trades: partial.total_closed_trades ?? 12
  };
}

describe("useResultWorkspaceState", () => {
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

  it("filters rows by flags", () => {
    const rows = [
      makeRow({ row_id: 1, passes_constraints: true, total_return_usdt: 5 }),
      makeRow({ row_id: 2, passes_constraints: false, total_return_usdt: 5 }),
      makeRow({ row_id: 3, passes_constraints: true, total_return_usdt: -1 })
    ];

    const filtered = filterOptimizationRows(rows, {
      showPassedOnly: true,
      showPositiveOnly: true,
      diagnosticMode: false
    });

    expect(filtered.map((row) => row.row_id)).toEqual([1]);
    expect(
      filterOptimizationRows(rows, {
        showPassedOnly: true,
        showPositiveOnly: true,
        diagnosticMode: true
      }).map((row) => row.row_id)
    ).toEqual([1, 2, 3]);
  });

  it("applies and toggles column state", () => {
    const hook = renderHook(() => useResultWorkspaceState({ optimizationResultTab: "table" }));

    act(() => {
      hook.value.applyColumnPreset("full");
    });
    expect(hook.value.tablePreset).toBe("full");

    act(() => {
      hook.value.toggleColumnVisibility("score", false);
    });
    expect(hook.value.columnVisibility.score).toBe(false);
    expect(hook.value.columnVisibility.actions).toBe(true);

    hook.unmount();
  });

  it("resets curve hover when tab leaves curves", () => {
    let tab: "table" | "curves" = "curves";
    const hook = renderHook(() => useResultWorkspaceState({ optimizationResultTab: tab }));

    act(() => {
      hook.value.setCurveHoverRatio(0.45);
    });
    expect(hook.value.curveHoverRatio).toBe(0.45);

    tab = "table";
    hook.rerender();
    expect(hook.value.curveHoverRatio).toBeNull();

    hook.unmount();
  });
});
