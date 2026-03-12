import type { LiveFill, LiveFundingEntry, LiveOpenOrder, LiveSnapshotResponse } from "../../lib/api-schema";

export type GridDirection = "long" | "short";

export interface FillPortion {
  fill: LiveFill;
  quantity: number;
  fee: number;
  realizedPnl: number;
}

export interface ClosedGridLedgerGroup {
  key: string;
  status: "closed";
  direction: GridDirection;
  quantity: number;
  realizedPnl: number;
  feesPaid: number;
  netPnl: number;
  openLeg: FillPortion;
  closeLeg: FillPortion;
  source: "matched" | "base_inferred";
}

export interface OpenGridLedgerGroup {
  key: string;
  status: "open";
  direction: GridDirection;
  quantity: number;
  feesPaid: number;
  unrealizedPnl: number;
  netPnl: number;
  openLeg: FillPortion;
  closeOrder?: LiveOpenOrder | null;
  source: "matched" | "base_inferred";
}

export interface FundingLedgerRow {
  key: string;
  timestamp: string;
  amount: number;
  currency: string | null;
}

interface OpenLot {
  key: string;
  direction: GridDirection;
  fill: LiveFill;
  remainingQty: number;
}

const EPSILON = 1e-9;

function asPositiveFinite(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

function resolveOpenGridReferencePrice(snapshot: LiveSnapshotResponse): number {
  return (
    asPositiveFinite(snapshot.market_params?.reference_price) ??
    asPositiveFinite(snapshot.position.mark_price) ??
    asPositiveFinite(snapshot.position.entry_price) ??
    0
  );
}

function normalizeDirection(snapshot: LiveSnapshotResponse): GridDirection {
  if (snapshot.robot.direction === "long" || snapshot.robot.direction === "short") {
    return snapshot.robot.direction;
  }
  if (snapshot.inferred_grid.side === "long" || snapshot.inferred_grid.side === "short") {
    return snapshot.inferred_grid.side;
  }
  if (snapshot.position.side === "short") {
    return "short";
  }
  return "long";
}

function ascendingFills(fills: LiveFill[]): LiveFill[] {
  return [...fills].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function ascendingFunding(entries: LiveFundingEntry[]): FundingLedgerRow[] {
  return [...entries]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .map((entry, index) => ({
      key: `${entry.timestamp}-${entry.amount}-${index}`,
      timestamp: entry.timestamp,
      amount: entry.amount,
      currency: entry.currency ?? null
    }));
}

function portion(value: number, matchedQty: number, totalQty: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(matchedQty) || !Number.isFinite(totalQty) || totalQty <= EPSILON) {
    return 0;
  }
  return value * (matchedQty / totalQty);
}

function buildFillPortion(fill: LiveFill, quantity: number): FillPortion {
  return {
    fill,
    quantity,
    fee: portion(fill.fee, quantity, fill.quantity),
    realizedPnl: portion(fill.realized_pnl, quantity, fill.quantity)
  };
}

function fillPlacedAt(fill: LiveFill): number {
  return Date.parse(fill.placed_at ?? fill.timestamp);
}

function fillTimestamp(fill: LiveFill): number {
  return Date.parse(fill.timestamp);
}

function orderTimestamp(order: LiveOpenOrder): number {
  return Date.parse(order.timestamp ?? new Date().toISOString());
}

function gridSpacing(snapshot: LiveSnapshotResponse): number {
  const spacing = snapshot.robot.grid_spacing ?? snapshot.inferred_grid.grid_spacing ?? 0;
  return Number.isFinite(spacing) ? Math.abs(spacing) : 0;
}

function priceTolerance(snapshot: LiveSnapshotResponse, spacing: number): number {
  const tick = Math.abs(snapshot.market_params?.price_tick_size ?? 0);
  return Math.max(tick * 2, spacing * 0.05, 0.2);
}

function contractSizeBase(snapshot: LiveSnapshotResponse): number {
  const value = snapshot.market_params?.contract_size_base ?? 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function pricesMatch(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function computeClosedGridPnl(direction: GridDirection, openFill: LiveFill, closeFill: LiveFill, quantity: number, contractSize: number): number {
  const signedDiff = direction === "long" ? closeFill.price - openFill.price : openFill.price - closeFill.price;
  return signedDiff * quantity * contractSize;
}

function computeOpenGridPnl(direction: GridDirection, openFill: LiveFill, markPrice: number, quantity: number, contractSize: number): number {
  const signedDiff = direction === "long" ? markPrice - openFill.price : openFill.price - markPrice;
  return signedDiff * quantity * contractSize;
}

function estimatedOpenFee(snapshot: LiveSnapshotResponse, openPrice: number, quantity: number, contractSize: number): number {
  const feeRate = snapshot.market_params?.maker_fee_rate ?? snapshot.market_params?.taker_fee_rate ?? 0;
  if (!Number.isFinite(feeRate) || feeRate <= 0) {
    return 0;
  }
  return openPrice * quantity * contractSize * feeRate;
}

function syntheticOpenPortion(
  snapshot: LiveSnapshotResponse,
  options: {
    direction: GridDirection;
    openPrice: number;
    quantity: number;
    timestamp: string;
    key: string;
  }
): FillPortion {
  const { direction, openPrice, quantity, timestamp, key } = options;
  const fee = estimatedOpenFee(snapshot, openPrice, quantity, contractSizeBase(snapshot));
  return {
    fill: {
      trade_id: key,
      order_id: key,
      side: direction === "short" ? "sell" : "buy",
      price: openPrice,
      quantity,
      realized_pnl: 0,
      fee,
      fee_currency: "USDT",
      is_maker: true,
      placed_at: timestamp,
      timestamp
    },
    quantity,
    fee,
    realizedPnl: 0
  };
}

function isBaseOrderTimestamp(timestamp: string | null | undefined, strategyStartedAt: string | null | undefined): boolean {
  if (!timestamp || !strategyStartedAt) {
    return false;
  }
  const diffMs = Math.abs(Date.parse(timestamp) - Date.parse(strategyStartedAt));
  return Number.isFinite(diffMs) && diffMs <= 15 * 60 * 1000;
}

function takeMatchingCloseLot(
  lots: OpenLot[],
  options: {
    direction: GridDirection;
    expectedOpenPrice: number;
    closeFill: LiveFill;
    tolerance: number;
  }
): number {
  const { direction, expectedOpenPrice, closeFill, tolerance } = options;
  return lots.findIndex((lot) => {
    if (lot.direction !== direction || lot.remainingQty <= EPSILON) {
      return false;
    }
    if (fillTimestamp(lot.fill) > fillTimestamp(closeFill)) {
      return false;
    }
    if (fillPlacedAt(closeFill) <= fillTimestamp(lot.fill)) {
      return false;
    }
    return pricesMatch(lot.fill.price, expectedOpenPrice, tolerance);
  });
}

function takeMatchingOpenLot(
  lots: OpenLot[],
  options: {
    direction: GridDirection;
    expectedOpenPrice: number;
    closeOrder?: LiveOpenOrder | null;
    tolerance: number;
  }
): number {
  const { direction, expectedOpenPrice, closeOrder, tolerance } = options;
  let bestIndex = -1;
  let bestTimestamp = Number.NEGATIVE_INFINITY;
  lots.forEach((lot, index) => {
    if (lot.direction !== direction || lot.remainingQty <= EPSILON) {
      return;
    }
    if (closeOrder && fillTimestamp(lot.fill) >= orderTimestamp(closeOrder)) {
      return;
    }
    if (!pricesMatch(lot.fill.price, expectedOpenPrice, tolerance)) {
      return;
    }
    const candidateTs = fillTimestamp(lot.fill);
    if (candidateTs > bestTimestamp) {
      bestTimestamp = candidateTs;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function buildGridLedgerGroups(snapshot: LiveSnapshotResponse): {
  closedGroups: ClosedGridLedgerGroup[];
  openGroups: OpenGridLedgerGroup[];
  fundingRows: FundingLedgerRow[];
  estimatedBaseLots: number;
} {
  const primaryDirection = normalizeDirection(snapshot);
  const spacing = gridSpacing(snapshot);
  const tolerance = priceTolerance(snapshot, spacing);
  const contractSize = contractSizeBase(snapshot);
  const markPrice = resolveOpenGridReferencePrice(snapshot);
  const openLots: OpenLot[] = [];
  const closedGroups: ClosedGridLedgerGroup[] = [];

  ascendingFills(snapshot.fills).forEach((fill, fillIndex) => {
    let remainingQty = fill.quantity;
    const isOpeningFill = (primaryDirection === "short" && fill.side === "sell") || (primaryDirection === "long" && fill.side === "buy");
    const isClosingFill = (primaryDirection === "short" && fill.side === "buy") || (primaryDirection === "long" && fill.side === "sell");

    if (isOpeningFill) {
      openLots.push({
        key: `${fill.trade_id || fill.order_id || fill.timestamp}-${fillIndex}`,
        direction: primaryDirection,
        fill,
        remainingQty
      });
      return;
    }

    if (!isClosingFill) {
      return;
    }

    const expectedOpenPrice = primaryDirection === "short" ? fill.price + spacing : fill.price - spacing;
    while (remainingQty > EPSILON) {
      const matchIndex = spacing > EPSILON
        ? takeMatchingCloseLot(openLots, {
            direction: primaryDirection,
            expectedOpenPrice,
            closeFill: fill,
            tolerance
          })
        : -1;
      if (matchIndex < 0) {
        break;
      }
      const matchedLot = openLots[matchIndex];
      const matchedQty = Math.min(matchedLot.remainingQty, remainingQty);
      const openLeg = buildFillPortion(matchedLot.fill, matchedQty);
      const closeLeg = buildFillPortion(fill, matchedQty);
      const realizedPnl = computeClosedGridPnl(primaryDirection, matchedLot.fill, fill, matchedQty, contractSize);
      const feesPaid = openLeg.fee + closeLeg.fee;
      closedGroups.push({
        key: `${matchedLot.key}-${fill.trade_id || fill.order_id || fill.timestamp}-${closedGroups.length}`,
        status: "closed",
        direction: primaryDirection,
        quantity: matchedQty,
        realizedPnl,
        feesPaid,
        netPnl: realizedPnl - feesPaid,
        openLeg,
        closeLeg,
        source: "matched"
      });
      matchedLot.remainingQty -= matchedQty;
      remainingQty -= matchedQty;
      if (matchedLot.remainingQty <= EPSILON) {
        openLots.splice(matchIndex, 1);
      }
    }

    if (remainingQty > EPSILON && snapshot.robot.strategy_start_price && isBaseOrderTimestamp(fill.placed_at, snapshot.robot.created_at ?? snapshot.window.strategy_started_at)) {
      const openLeg = syntheticOpenPortion(snapshot, {
        direction: primaryDirection,
        openPrice: snapshot.robot.strategy_start_price,
        quantity: remainingQty,
        timestamp: snapshot.window.strategy_started_at,
        key: `base-closed-${fill.trade_id}`
      });
      const closeLeg = buildFillPortion(fill, remainingQty);
      const realizedPnl = computeClosedGridPnl(primaryDirection, openLeg.fill, fill, remainingQty, contractSize);
      const feesPaid = openLeg.fee + closeLeg.fee;
      closedGroups.push({
        key: `base-closed-${fill.trade_id}`,
        status: "closed",
        direction: primaryDirection,
        quantity: remainingQty,
        realizedPnl,
        feesPaid,
        netPnl: realizedPnl - feesPaid,
        openLeg,
        closeLeg,
        source: "base_inferred"
      });
    }
  });

  const remainingLots = [...openLots];
  const openGroups: OpenGridLedgerGroup[] = [];
  const closeOrders = [...snapshot.open_orders]
    .filter((order) => order.status === "live")
    .sort((left, right) => orderTimestamp(right) - orderTimestamp(left));

  closeOrders.forEach((order, index) => {
    const expectedCloseSide = primaryDirection === "short" ? "buy" : "sell";
    if (order.side !== expectedCloseSide) {
      return;
    }
    const isBaseLevel = isBaseOrderTimestamp(order.timestamp ?? null, snapshot.robot.created_at ?? snapshot.window.strategy_started_at);

    const expectedOpenPrice = isBaseLevel && snapshot.robot.strategy_start_price
      ? snapshot.robot.strategy_start_price
      : primaryDirection === "long"
        ? order.price - spacing
        : order.price + spacing;

    const matchIndex = !isBaseLevel && spacing > EPSILON
      ? takeMatchingOpenLot(remainingLots, {
          direction: primaryDirection,
          expectedOpenPrice,
          closeOrder: order,
          tolerance
        })
      : -1;

    if (matchIndex >= 0) {
      const matchedLot = remainingLots[matchIndex];
      const matchedQty = Math.min(matchedLot.remainingQty, order.quantity);
      const openLeg = buildFillPortion(matchedLot.fill, matchedQty);
      const unrealizedPnl = computeOpenGridPnl(primaryDirection, matchedLot.fill, markPrice, matchedQty, contractSize);
      const feesPaid = openLeg.fee;
      openGroups.push({
        key: `${matchedLot.key}-order-${order.order_id || index}`,
        status: "open",
        direction: primaryDirection,
        quantity: matchedQty,
        feesPaid,
        unrealizedPnl,
        netPnl: unrealizedPnl - feesPaid,
        openLeg,
        closeOrder: order,
        source: "matched"
      });
      matchedLot.remainingQty -= matchedQty;
      if (matchedLot.remainingQty <= EPSILON) {
        remainingLots.splice(matchIndex, 1);
      }
      return;
    }

    if (isBaseLevel && snapshot.robot.strategy_start_price) {
      const openLeg = syntheticOpenPortion(snapshot, {
        direction: primaryDirection,
        openPrice: snapshot.robot.strategy_start_price,
        quantity: order.quantity,
        timestamp: snapshot.window.strategy_started_at,
        key: `base-open-${order.order_id || index}`
      });
      const unrealizedPnl = computeOpenGridPnl(primaryDirection, openLeg.fill, markPrice, order.quantity, contractSize);
      const feesPaid = openLeg.fee;
      openGroups.push({
        key: `base-open-${order.order_id || index}`,
        status: "open",
        direction: primaryDirection,
        quantity: order.quantity,
        feesPaid,
        unrealizedPnl,
        netPnl: unrealizedPnl - feesPaid,
        openLeg,
        closeOrder: order,
        source: "base_inferred"
      });
    }
  });

  if (closeOrders.length === 0) {
    remainingLots
      .filter((lot) => lot.remainingQty > EPSILON)
      .forEach((lot, index) => {
        const openLeg = buildFillPortion(lot.fill, lot.remainingQty);
        const unrealizedPnl = computeOpenGridPnl(lot.direction, lot.fill, markPrice, lot.remainingQty, contractSize);
        const feesPaid = openLeg.fee;
        openGroups.push({
          key: `${lot.key}-fallback-${index}`,
          status: "open",
          direction: lot.direction,
          quantity: lot.remainingQty,
          feesPaid,
          unrealizedPnl,
          netPnl: unrealizedPnl - feesPaid,
          openLeg,
          closeOrder: null,
          source: "matched"
        });
      });
  }

  const estimatedBaseLots = openGroups.filter((group) => group.source === "base_inferred").length;

  return {
    closedGroups: closedGroups.sort((left, right) => Date.parse(left.closeLeg.fill.timestamp) - Date.parse(right.closeLeg.fill.timestamp)),
    openGroups: openGroups.sort((left, right) => Date.parse(left.closeOrder?.timestamp ?? left.openLeg.fill.timestamp) - Date.parse(right.closeOrder?.timestamp ?? right.openLeg.fill.timestamp)),
    fundingRows: ascendingFunding(snapshot.funding_entries),
    estimatedBaseLots
  };
}

function matchesTimeFilter(timestamp: string, timeFilter: "all" | "24h" | "7d" | "30d", now: number): boolean {
  if (timeFilter === "all") {
    return true;
  }
  const hours = timeFilter === "24h" ? 24 : timeFilter === "7d" ? 24 * 7 : 24 * 30;
  return now - Date.parse(timestamp) <= hours * 3600 * 1000;
}

export function filterClosedGridGroups(
  groups: ClosedGridLedgerGroup[],
  options: {
    timeFilter: "all" | "24h" | "7d" | "30d";
    searchQuery: string;
    sideFilter: "all" | "buy" | "sell";
    realizedOnly: boolean;
    now: number;
  }
): ClosedGridLedgerGroup[] {
  const { timeFilter, searchQuery, sideFilter, realizedOnly, now } = options;
  const query = searchQuery.trim().toLowerCase();
  return groups.filter((group) => {
    if (!matchesTimeFilter(group.closeLeg.fill.timestamp, timeFilter, now)) {
      return false;
    }
    if (sideFilter !== "all" && group.openLeg.fill.side !== sideFilter) {
      return false;
    }
    if (realizedOnly && Math.abs(group.realizedPnl) <= EPSILON) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      group.openLeg.fill.order_id,
      group.openLeg.fill.trade_id,
      group.closeLeg.fill.order_id,
      group.closeLeg.fill.trade_id,
      group.openLeg.fill.timestamp,
      group.closeLeg.fill.timestamp,
      group.openLeg.fill.side,
      group.closeLeg.fill.side,
      group.direction,
      "已平仓网格"
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function filterOpenGridGroups(
  groups: OpenGridLedgerGroup[],
  options: {
    timeFilter: "all" | "24h" | "7d" | "30d";
    searchQuery: string;
    sideFilter: "all" | "buy" | "sell";
    now: number;
  }
): OpenGridLedgerGroup[] {
  const { timeFilter, searchQuery, sideFilter, now } = options;
  const query = searchQuery.trim().toLowerCase();
  return groups.filter((group) => {
    if (!matchesTimeFilter(group.closeOrder?.timestamp ?? group.openLeg.fill.timestamp, timeFilter, now)) {
      return false;
    }
    if (sideFilter !== "all" && group.openLeg.fill.side !== sideFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      group.openLeg.fill.order_id,
      group.openLeg.fill.trade_id,
      group.closeOrder?.order_id,
      group.openLeg.fill.timestamp,
      group.closeOrder?.timestamp,
      group.openLeg.fill.side,
      group.direction,
      group.source,
      "未平仓网格"
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function filterFundingRows(
  rows: FundingLedgerRow[],
  options: {
    timeFilter: "all" | "24h" | "7d" | "30d";
    searchQuery: string;
    now: number;
  }
): FundingLedgerRow[] {
  const { timeFilter, searchQuery, now } = options;
  const query = searchQuery.trim().toLowerCase();
  return rows.filter((row) => {
    if (!matchesTimeFilter(row.timestamp, timeFilter, now)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [row.timestamp, row.currency, row.amount, "资金费"].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}
