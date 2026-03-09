import { GridSide } from "../types";

export function buildGridNodes(lower: number, upper: number, grids: number): { nodes: number[]; eps: number } {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(grids) || grids <= 0) {
    return { nodes: [], eps: 1e-8 };
  }
  const gridSize = (upper - lower) / grids;
  const nodes = Array.from({ length: grids + 1 }, (_, index) => lower + index * gridSize);
  const eps = Math.max(Math.abs(gridSize) * 1e-9, 1e-8);
  return { nodes, eps };
}

function bisectLeft(values: number[], target: number): number {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (values[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
}

function bisectRight(values: number[], target: number): number {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (values[mid] <= target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
}

export function deriveBasePositionGridIndices({
  side,
  useBasePosition,
  currentPrice,
  nodes,
  eps
}: {
  side: GridSide;
  useBasePosition: boolean;
  currentPrice: number;
  nodes: number[];
  eps?: number;
}): number[] {
  if (!useBasePosition || nodes.length < 2 || !Number.isFinite(currentPrice)) {
    return [];
  }

  const inferredGridSize = nodes.length > 1 ? (nodes[nodes.length - 1] - nodes[0]) / (nodes.length - 1) : 0;
  const safeEps = Number.isFinite(eps) ? Math.max(eps ?? 0, 1e-8) : Math.max(Math.abs(inferredGridSize) * 1e-9, 1e-8);
  const grids = nodes.length - 1;
  const lowerSplit = bisectLeft(nodes, currentPrice - safeEps);
  const upperSplit = bisectRight(nodes, currentPrice + safeEps);

  if (side === "long") {
    const start = Math.min(Math.max(lowerSplit, 0), grids);
    return Array.from({ length: Math.max(0, grids - start) }, (_, index) => start + index);
  }

  const count = Math.min(Math.max(upperSplit - 1, 0), grids);
  return Array.from({ length: count }, (_, index) => index);
}

export function deriveInitialPendingGridMarkers({
  side,
  useBasePosition,
  baseGridCount,
  currentPrice,
  gridLines
}: {
  side: GridSide;
  useBasePosition: boolean;
  baseGridCount?: number;
  currentPrice: number;
  gridLines: number[];
}): {
  baseGridIndices: number[];
  pendingGridIndices: number[];
  pendingOrderLevels: number[];
} {
  if (!useBasePosition || gridLines.length < 2 || !Number.isFinite(currentPrice)) {
    return {
      baseGridIndices: [],
      pendingGridIndices: [],
      pendingOrderLevels: []
    };
  }

  const inferredGridSize = (gridLines[gridLines.length - 1] - gridLines[0]) / (gridLines.length - 1);
  const eps = Math.max(Math.abs(inferredGridSize) * 1e-9, 1e-8);
  const derivedBaseIndices = deriveBasePositionGridIndices({
    side,
    useBasePosition,
    currentPrice,
    nodes: gridLines,
    eps
  });
  const normalizedBaseCount = Number.isFinite(baseGridCount)
    ? Math.max(0, Math.min(Math.floor(Number(baseGridCount)), derivedBaseIndices.length))
    : derivedBaseIndices.length;
  const baseGridIndices = derivedBaseIndices.slice(0, normalizedBaseCount);
  const baseGridSet = new Set(baseGridIndices);
  const pendingGridIndices: number[] = [];
  const pendingOrderLevels: number[] = [];
  const grids = gridLines.length - 1;

  for (let gridIndex = 0; gridIndex < grids; gridIndex += 1) {
    if (baseGridSet.has(gridIndex)) {
      continue;
    }
    const priceLevel = side === "long" ? gridLines[gridIndex] : gridLines[gridIndex + 1];
    if (!Number.isFinite(priceLevel)) {
      continue;
    }
    pendingGridIndices.push(gridIndex);
    pendingOrderLevels.push(priceLevel);
  }

  return {
    baseGridIndices,
    pendingGridIndices,
    pendingOrderLevels
  };
}
