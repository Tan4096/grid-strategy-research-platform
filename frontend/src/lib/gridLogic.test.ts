import { describe, expect, it } from "vitest";
import { buildGridNodes, deriveBasePositionGridIndices, deriveInitialPendingGridMarkers } from "./gridLogic";

describe("gridLogic", () => {
  it("derives short base indices with upper boundary pending", () => {
    const { nodes, eps } = buildGridNodes(65000, 71000, 12);
    const baseIndices = deriveBasePositionGridIndices({
      side: "short",
      useBasePosition: true,
      currentPrice: 67200,
      nodes,
      eps
    });

    expect(baseIndices).toEqual([0, 1, 2, 3]);

    const pending = deriveInitialPendingGridMarkers({
      side: "short",
      useBasePosition: true,
      baseGridCount: baseIndices.length,
      currentPrice: 67200,
      gridLines: nodes
    });

    expect(pending.pendingGridIndices[0]).toBe(4);
    expect(pending.pendingOrderLevels[0]).toBe(67500);
    expect(pending.pendingOrderLevels[pending.pendingOrderLevels.length - 1]).toBe(71000);
  });

  it("derives long base indices with lower boundary pending", () => {
    const { nodes, eps } = buildGridNodes(65000, 71000, 12);
    const baseIndices = deriveBasePositionGridIndices({
      side: "long",
      useBasePosition: true,
      currentPrice: 67200,
      nodes,
      eps
    });

    expect(baseIndices).toEqual([5, 6, 7, 8, 9, 10, 11]);

    const pending = deriveInitialPendingGridMarkers({
      side: "long",
      useBasePosition: true,
      baseGridCount: baseIndices.length,
      currentPrice: 67200,
      gridLines: nodes
    });

    expect(pending.pendingGridIndices).toEqual([0, 1, 2, 3, 4]);
    expect(pending.pendingOrderLevels[0]).toBe(65000);
    expect(pending.pendingOrderLevels[pending.pendingOrderLevels.length - 1]).toBe(67000);
  });
});
