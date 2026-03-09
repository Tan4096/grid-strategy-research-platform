import {
  CurvePoint,
  LiveCompleteness,
  LiveDailyBreakdown,
  LiveDiagnostic,
  LiveFill,
  LiveFundingEntry,
  LiveLedgerEntry,
  LiveLedgerSummary,
  LiveMonitoringInfo,
  LiveOpenOrder,
  LivePosition,
  LiveRobotOverview,
  LiveRobotListItem,
  LiveRobotListRequest,
  LiveRobotListResponse,
  LiveRobotListScope,
  LiveSnapshotRequest,
  LiveSnapshotResponse,
  LiveSnapshotSummary,
  LiveWindowInfo,
  MarketParamsResponse
} from "../../types";
import {
  asBoolean,
  asNullableBoolean,
  asNullableNumber,
  asNullableString,
  asNumber,
  asString,
  floorIsoToMinute,
  isRecord,
  requestJson,
  type RequestOptions
} from "./core";

function normalizeLiveFill(raw: unknown): LiveFill | null {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    trade_id: asString(raw.trade_id || raw.tradeId, "unknown"),
    order_id: asString(raw.order_id || raw.orderId, "") || null,
    side: asString(raw.side, "buy") === "sell" ? "sell" : "buy",
    price: asNumber(raw.price),
    quantity: asNumber(raw.quantity),
    realized_pnl: asNumber(raw.realized_pnl ?? raw.realizedPnl),
    fee: asNumber(raw.fee),
    fee_currency: asString(raw.fee_currency ?? raw.feeCcy, "") || null,
    is_maker:
      typeof raw.is_maker === "boolean"
        ? raw.is_maker
        : typeof raw.isMaker === "boolean"
          ? raw.isMaker
          : null,
    timestamp: asString(raw.timestamp, new Date().toISOString())
  };
}

function normalizeLiveFundingEntry(raw: unknown): LiveFundingEntry | null {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    timestamp: asString(raw.timestamp, new Date().toISOString()),
    amount: asNumber(raw.amount),
    rate: raw.rate === null || raw.rate === undefined ? null : asNumber(raw.rate),
    position_size:
      raw.position_size === null || raw.position_size === undefined ? null : asNumber(raw.position_size),
    currency: asString(raw.currency, "") || null
  };
}

function normalizeLedgerKind(value: unknown): LiveLedgerEntry["kind"] {
  const raw = asString(value, "trade").trim().toLowerCase();
  if (raw.includes("fund")) {
    return "funding";
  }
  if (raw.includes("fee") || raw.includes("commission")) {
    return "fee";
  }
  return "trade";
}

function buildFillDerivedLedgerEntries(fills: LiveFill[]): LiveLedgerEntry[] {
  const entries: LiveLedgerEntry[] = [];
  fills.forEach((fill) => {
    entries.push({
      timestamp: fill.timestamp,
      kind: "trade",
      amount: fill.realized_pnl,
      pnl: fill.realized_pnl,
      fee: 0,
      currency: fill.fee_currency ?? null,
      side: fill.side,
      order_id: fill.order_id ?? null,
      trade_id: fill.trade_id,
      is_maker: fill.is_maker ?? null,
      note: "成交已实现盈亏"
    });
    if (Math.abs(fill.fee) > 0) {
      entries.push({
        timestamp: fill.timestamp,
        kind: "fee",
        amount: -Math.abs(fill.fee),
        pnl: 0,
        fee: Math.abs(fill.fee),
        currency: fill.fee_currency ?? null,
        side: fill.side,
        order_id: fill.order_id ?? null,
        trade_id: fill.trade_id,
        is_maker: fill.is_maker ?? null,
        note: "成交手续费"
      });
    }
  });
  return entries;
}

function buildFundingDerivedLedgerEntries(fundingEntries: LiveFundingEntry[]): LiveLedgerEntry[] {
  return fundingEntries.map((entry) => ({
    timestamp: entry.timestamp,
    kind: "funding",
    amount: entry.amount,
    pnl: 0,
    fee: 0,
    currency: entry.currency ?? null,
    side: null,
    order_id: null,
    trade_id: null,
    is_maker: null,
    note: "资金费"
  }));
}

function ledgerEntryMatchesFill(entry: LiveLedgerEntry, fill: LiveFill): boolean {
  if (entry.trade_id && fill.trade_id && entry.trade_id === fill.trade_id) {
    return true;
  }
  if (entry.order_id && fill.order_id && entry.order_id === fill.order_id) {
    return true;
  }
  return entry.timestamp === fill.timestamp && (entry.side ?? null) === fill.side;
}

function normalizeLedgerEntries(
  rawEntries: unknown,
  fills: LiveFill[],
  fundingEntries: LiveFundingEntry[]
): LiveLedgerEntry[] {
  const entries: LiveLedgerEntry[] = Array.isArray(rawEntries) && rawEntries.length > 0
    ? rawEntries.flatMap((raw) => {
        if (!isRecord(raw)) {
          return [];
        }
        return [{
          timestamp: asString(raw.timestamp, new Date().toISOString()),
          kind: normalizeLedgerKind(raw.kind ?? raw.type ?? raw.entry_type),
          amount: asNumber(raw.amount, asNumber(raw.pnl ?? raw.realized_pnl ?? raw.realizedPnl)),
          pnl: asNumber(raw.pnl ?? raw.realized_pnl ?? raw.realizedPnl),
          fee: asNumber(raw.fee ?? raw.fees_paid ?? raw.feePaid),
          currency: asString(raw.currency, "") || null,
          side: (asString(raw.side, "") as LiveLedgerEntry["side"]) || null,
          order_id: asString(raw.order_id ?? raw.orderId, "") || null,
          trade_id: asString(raw.trade_id ?? raw.tradeId, "") || null,
          is_maker:
            typeof raw.is_maker === "boolean"
              ? raw.is_maker
              : typeof raw.isMaker === "boolean"
                ? raw.isMaker
                : null,
          note: asString(raw.note ?? raw.remark, "") || null
        }];
      })
    : [];

  buildFillDerivedLedgerEntries(fills).forEach((derived) => {
    if (derived.kind === "trade") {
      const matchedIndex = entries.findIndex((entry) => entry.kind === "trade" && ledgerEntryMatchesFill(entry, {
        trade_id: derived.trade_id ?? "unknown",
        order_id: derived.order_id ?? null,
        side: derived.side ?? "buy",
        price: 0,
        quantity: 0,
        realized_pnl: derived.pnl,
        fee: 0,
        fee_currency: derived.currency ?? null,
        is_maker: derived.is_maker ?? null,
        timestamp: derived.timestamp
      }));
      if (matchedIndex >= 0) {
        const current = entries[matchedIndex];
        entries[matchedIndex] = {
          ...current,
          amount: Math.abs(current.amount) > 1e-9 ? current.amount : derived.amount,
          pnl: Math.abs(current.pnl) > 1e-9 ? current.pnl : derived.pnl,
          currency: current.currency ?? derived.currency,
          side: current.side ?? derived.side,
          order_id: current.order_id ?? derived.order_id,
          trade_id: current.trade_id ?? derived.trade_id,
          is_maker: current.is_maker ?? derived.is_maker
        };
      } else {
        entries.push(derived);
      }
      return;
    }

    const matchedIndex = entries.findIndex(
      (entry) =>
        entry.kind === "fee" &&
        ((entry.trade_id && derived.trade_id && entry.trade_id === derived.trade_id) ||
          (entry.order_id && derived.order_id && entry.order_id === derived.order_id) ||
          (entry.timestamp === derived.timestamp && (entry.side ?? null) === (derived.side ?? null)))
    );
    if (matchedIndex >= 0) {
      const current = entries[matchedIndex];
      entries[matchedIndex] = {
        ...current,
        amount: Math.abs(current.amount) > 1e-9 ? current.amount : derived.amount,
        fee: Math.abs(current.fee) > 1e-9 ? current.fee : derived.fee,
        currency: current.currency ?? derived.currency,
        side: current.side ?? derived.side,
        order_id: current.order_id ?? derived.order_id,
        trade_id: current.trade_id ?? derived.trade_id,
        is_maker: current.is_maker ?? derived.is_maker
      };
    } else {
      entries.push(derived);
    }
  });

  buildFundingDerivedLedgerEntries(fundingEntries).forEach((derived) => {
    const matchedIndex = entries.findIndex(
      (entry) =>
        entry.kind === "funding" &&
        entry.timestamp === derived.timestamp &&
        Math.abs(entry.amount - derived.amount) <= 1e-9
    );
    if (matchedIndex < 0) {
      entries.push(derived);
    }
  });

  return entries.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function normalizeLiveRobotListResponse(raw: unknown): LiveRobotListResponse {
  const root = isRecord(raw) ? raw : {};
  const items: LiveRobotListItem[] = [];
  if (Array.isArray(root.items)) {
    root.items.forEach((item) => {
      if (!isRecord(item)) {
        return;
      }
      items.push({
        algo_id: asString(item.algo_id),
        name: asString(item.name, "未命名对象"),
        symbol: asString(item.symbol),
        exchange_symbol: asString(item.exchange_symbol, asString(item.symbol)),
        updated_at: asNullableString(item.updated_at),
        run_type: asNullableString(item.run_type),
        configured_leverage: asNullableNumber(item.configured_leverage),
        investment_usdt: asNullableNumber(item.investment_usdt),
        lower_price: asNullableNumber(item.lower_price),
        upper_price: asNullableNumber(item.upper_price),
        grid_count: asNullableNumber(item.grid_count),
        state: asNullableString(item.state),
        side: (asNullableString(item.side) as LiveRobotListItem["side"]) ?? null
      });
    });
  }
  return {
    scope: (asString(root.scope, "running") as LiveRobotListScope) || "running",
    items
  };
}

function formatLocalLedgerDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return asString(value).slice(0, 10);
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDailyBreakdownFromLedgerEntries(ledgerEntries: LiveLedgerEntry[]): LiveDailyBreakdown[] {
  const grouped = new Map<string, LiveDailyBreakdown>();
  ledgerEntries.forEach((entry) => {
    const key = formatLocalLedgerDate(asString(entry.timestamp));
    const current = grouped.get(key) ?? {
      date: key,
      realized_pnl: 0,
      fees_paid: 0,
      funding_net: 0,
      trading_net: 0,
      total_pnl: 0,
      entry_count: 0
    };
    current.entry_count += 1;
    current.realized_pnl += entry.kind === "funding" ? 0 : entry.pnl;
    current.fees_paid += Math.abs(entry.fee);
    if (entry.kind === "funding") {
      current.funding_net += entry.amount;
    }
    current.trading_net = current.realized_pnl - current.fees_paid;
    current.total_pnl = current.trading_net + current.funding_net;
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((left, right) => right.date.localeCompare(left.date));
}

function normalizeDailyBreakdown(raw: unknown, ledgerEntries: LiveLedgerEntry[]): LiveDailyBreakdown[] {
  if (ledgerEntries.length > 0) {
    return buildDailyBreakdownFromLedgerEntries(ledgerEntries);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const items: LiveDailyBreakdown[] = [];
  raw.forEach((item) => {
    if (!isRecord(item)) {
      return;
    }
    items.push({
      date: asString(item.date),
      realized_pnl: asNumber(item.realized_pnl),
      fees_paid: asNumber(item.fees_paid),
      funding_net: asNumber(item.funding_net),
      trading_net: asNumber(item.trading_net),
      total_pnl: asNumber(item.total_pnl),
      entry_count: asNumber(item.entry_count)
    });
  });
  return items.sort((left, right) => right.date.localeCompare(left.date));
}

function normalizeCurvePoints(raw: unknown): CurvePoint[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const points: CurvePoint[] = [];
  raw.forEach((item) => {
    if (!isRecord(item)) {
      return;
    }
    points.push({
      timestamp: asString(item.timestamp, new Date().toISOString()),
      value: asNumber(item.value)
    });
  });
  return points;
}

function normalizeLiveSnapshotResponse(raw: unknown): LiveSnapshotResponse {
  const fallbackNow = new Date().toISOString();
  const root = isRecord(raw) ? raw : {};
  const accountRaw = isRecord(root.account) ? root.account : {};
  const summaryRaw = isRecord(root.summary) ? root.summary : {};
  const positionRaw = isRecord(root.position) ? root.position : {};
  const inferredGridRaw = isRecord(root.inferred_grid) ? root.inferred_grid : {};
  const robotRaw = isRecord(root.robot) ? root.robot : {};
  const marketParamsRaw = isRecord(root.market_params) ? root.market_params : null;
  const fills = Array.isArray(root.fills)
    ? root.fills.map(normalizeLiveFill).filter((item): item is LiveFill => item !== null)
    : [];
  const fundingEntries = Array.isArray(root.funding_entries)
    ? root.funding_entries.map(normalizeLiveFundingEntry).filter((item): item is LiveFundingEntry => item !== null)
    : [];
  const fetchedAt = asString(accountRaw.fetched_at, fallbackNow);
  const strategyStartedAt = asString(accountRaw.strategy_started_at, fallbackNow);
  const diagnostics: LiveDiagnostic[] = [];
  if (Array.isArray(root.diagnostics)) {
    root.diagnostics.forEach((item) => {
      if (!isRecord(item)) {
        return;
      }
      diagnostics.push({
        level: asString(item.level, "info") as LiveDiagnostic["level"],
        code: asString(item.code),
        message: asString(item.message),
        action_hint: asString(item.action_hint, "") || null
      });
    });
  }
  const windowInfo: LiveWindowInfo = {
    strategy_started_at: isRecord(root.window)
      ? asString(root.window.strategy_started_at, strategyStartedAt)
      : strategyStartedAt,
    fetched_at: isRecord(root.window) ? asString(root.window.fetched_at, fetchedAt) : fetchedAt,
    compared_end_at: isRecord(root.window)
      ? asString(root.window.compared_end_at, floorIsoToMinute(fetchedAt))
      : floorIsoToMinute(fetchedAt)
  };
  const completeness: LiveCompleteness = {
    fills_complete: isRecord(root.completeness)
      ? asBoolean(
          root.completeness.fills_complete,
          !diagnostics.some(
            (item) =>
              item.code === "fills_truncated" ||
              item.code === "fills_not_available" ||
              item.code === "LIVE_BOT_FILLS_CAPPED"
          )
        )
      : !diagnostics.some(
          (item) =>
            item.code === "fills_truncated" ||
            item.code === "fills_not_available" ||
            item.code === "LIVE_BOT_FILLS_CAPPED"
        ),
    funding_complete: isRecord(root.completeness)
      ? asBoolean(root.completeness.funding_complete, !diagnostics.some((item) => item.code.startsWith("funding_")))
      : !diagnostics.some((item) => item.code.startsWith("funding_")),
    bills_window_clipped: isRecord(root.completeness)
      ? asBoolean(root.completeness.bills_window_clipped, diagnostics.some((item) => item.code === "funding_window_clipped"))
      : diagnostics.some((item) => item.code === "funding_window_clipped"),
    partial_failures:
      isRecord(root.completeness) && Array.isArray(root.completeness.partial_failures)
        ? root.completeness.partial_failures.filter((item): item is string => typeof item === "string")
        : diagnostics
            .filter((item) =>
              item.code.endsWith("_not_available") ||
              item.code.endsWith("_truncated") ||
              item.code === "market_params_unavailable" ||
              item.code === "LIVE_BOT_ORDERS_UNAVAILABLE" ||
              item.code === "LIVE_BOT_FILLS_CAPPED" ||
              item.code === "LIVE_BOT_SNAPSHOT_STALE"
            )
            .map((item) => item.code)
  };
  const summary: LiveSnapshotSummary = {
    realized_pnl: asNumber(
      summaryRaw.realized_pnl,
      fills.reduce((sum, item) => sum + item.realized_pnl, asNumber(positionRaw.realized_pnl))
    ),
    unrealized_pnl: asNumber(summaryRaw.unrealized_pnl, asNumber(positionRaw.unrealized_pnl)),
    fees_paid: asNumber(summaryRaw.fees_paid, fills.reduce((sum, item) => sum + Math.abs(item.fee), 0)),
    funding_paid: asNumber(
      summaryRaw.funding_paid,
      fundingEntries.filter((item) => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0)
    ),
    funding_net: asNumber(summaryRaw.funding_net, fundingEntries.reduce((sum, item) => sum + item.amount, 0)),
    total_pnl: asNumber(summaryRaw.total_pnl, 0),
    position_notional: asNumber(summaryRaw.position_notional, asNumber(positionRaw.notional)),
    open_order_count: asNumber(summaryRaw.open_order_count, Array.isArray(root.open_orders) ? root.open_orders.length : 0),
    fill_count: asNumber(summaryRaw.fill_count, fills.length)
  };
  if (!Number.isFinite(summary.total_pnl) || summary.total_pnl === 0) {
    summary.total_pnl = summary.realized_pnl + summary.unrealized_pnl - summary.fees_paid + summary.funding_net;
  }
  const ledgerSummary: LiveLedgerSummary = isRecord(root.ledger_summary)
    ? {
        trading_net: asNumber(root.ledger_summary.trading_net),
        fees: asNumber(root.ledger_summary.fees, summary.fees_paid),
        funding: asNumber(root.ledger_summary.funding, summary.funding_net),
        total_pnl: asNumber(root.ledger_summary.total_pnl, summary.total_pnl),
        realized: asNumber(root.ledger_summary.realized, summary.realized_pnl),
        unrealized: asNumber(root.ledger_summary.unrealized, summary.unrealized_pnl)
      }
    : {
        trading_net: summary.total_pnl - summary.unrealized_pnl - summary.funding_net,
        fees: summary.fees_paid,
        funding: summary.funding_net,
        total_pnl: summary.total_pnl,
        realized: summary.realized_pnl,
        unrealized: summary.unrealized_pnl
      };
  const ledgerEntries = normalizeLedgerEntries(root.ledger_entries, fills, fundingEntries);
  const dailyBreakdown = normalizeDailyBreakdown(root.daily_breakdown, ledgerEntries);
  const inferredGrid = {
    lower: inferredGridRaw.lower === null || inferredGridRaw.lower === undefined ? null : asNumber(inferredGridRaw.lower),
    upper: inferredGridRaw.upper === null || inferredGridRaw.upper === undefined ? null : asNumber(inferredGridRaw.upper),
    grid_count:
      inferredGridRaw.grid_count === null || inferredGridRaw.grid_count === undefined
        ? null
        : asNumber(inferredGridRaw.grid_count),
    grid_spacing:
      inferredGridRaw.grid_spacing === null || inferredGridRaw.grid_spacing === undefined
        ? null
        : asNumber(inferredGridRaw.grid_spacing),
    active_level_count: asNumber(inferredGridRaw.active_level_count, 0),
    active_levels: Array.isArray(inferredGridRaw.active_levels)
      ? inferredGridRaw.active_levels.filter((item): item is number => typeof item === "number")
      : [],
    confidence: asNumber(inferredGridRaw.confidence),
    use_base_position:
      inferredGridRaw.use_base_position === null || inferredGridRaw.use_base_position === undefined
        ? null
        : asBoolean(inferredGridRaw.use_base_position),
    side: (asString(inferredGridRaw.side, "") as LiveSnapshotResponse["inferred_grid"]["side"]) || null,
    note: asString(inferredGridRaw.note, "") || null
  };
  const monitoringRaw = isRecord(root.monitoring) ? root.monitoring : {};
  const monitoring: LiveMonitoringInfo = {
    poll_interval_sec: asNumber(monitoringRaw.poll_interval_sec, 15),
    last_success_at: asString(monitoringRaw.last_success_at, fetchedAt),
    freshness_sec: asNumber(monitoringRaw.freshness_sec, 0),
    stale: asBoolean(monitoringRaw.stale, false),
    source_latency_ms: asNumber(monitoringRaw.source_latency_ms, 0),
    fills_page_count: asNumber(monitoringRaw.fills_page_count, 0),
    fills_capped: asBoolean(monitoringRaw.fills_capped, false),
    orders_page_count: asNumber(monitoringRaw.orders_page_count, 0)
  };
  const robot: LiveRobotOverview = {
    algo_id: asString(robotRaw.algo_id, asString(accountRaw.algo_id, "")),
    name: asString(
      robotRaw.name,
      asString(accountRaw.algo_id, "") ? `OKX 机器人 ${asString(accountRaw.algo_id, "").slice(-6)}` : "未命名机器人"
    ),
    state: asNullableString(robotRaw.state),
    direction:
      (asString(
        robotRaw.direction,
        positionRaw.side === "short" ? "short" : positionRaw.side === "long" ? "long" : "flat"
      ) as LiveRobotOverview["direction"]) || null,
    algo_type: asNullableString(robotRaw.algo_type),
    run_type: asNullableString(robotRaw.run_type),
    created_at: asNullableString(robotRaw.created_at),
    updated_at: asNullableString(robotRaw.updated_at) ?? fetchedAt,
    investment_usdt: asNullableNumber(robotRaw.investment_usdt) ?? asNullableNumber(positionRaw.notional),
    configured_leverage:
      asNullableNumber(robotRaw.configured_leverage) ??
      (positionRaw.leverage === null || positionRaw.leverage === undefined ? null : asNumber(positionRaw.leverage)),
    actual_leverage: asNullableNumber(robotRaw.actual_leverage),
    liquidation_price:
      asNullableNumber(robotRaw.liquidation_price ?? robotRaw.liquidationPrice) ??
      (positionRaw.liquidation_price === null || positionRaw.liquidation_price === undefined
        ? null
        : asNumber(positionRaw.liquidation_price)),
    grid_count: asNullableNumber(robotRaw.grid_count) ?? inferredGrid.grid_count,
    lower_price: asNullableNumber(robotRaw.lower_price) ?? inferredGrid.lower,
    upper_price: asNullableNumber(robotRaw.upper_price) ?? inferredGrid.upper,
    grid_spacing: asNullableNumber(robotRaw.grid_spacing) ?? inferredGrid.grid_spacing,
    grid_profit: asNullableNumber(robotRaw.grid_profit) ?? asNullableNumber(summary.realized_pnl),
    floating_profit: asNullableNumber(robotRaw.floating_profit) ?? asNullableNumber(summary.unrealized_pnl),
    total_fee: asNullableNumber(robotRaw.total_fee) ?? asNullableNumber(summary.fees_paid),
    funding_fee: asNullableNumber(robotRaw.funding_fee) ?? asNullableNumber(summary.funding_net),
    total_pnl: asNullableNumber(robotRaw.total_pnl) ?? asNullableNumber(summary.total_pnl),
    pnl_ratio: asNullableNumber(robotRaw.pnl_ratio),
    stop_loss_price: asNullableNumber(
      robotRaw.stop_loss_price ??
        robotRaw.stopLossPrice ??
        robotRaw.stop_price ??
        robotRaw.stopPrice ??
        robotRaw.slTriggerPx
    ),
    take_profit_price: asNullableNumber(
      robotRaw.take_profit_price ?? robotRaw.takeProfitPrice ?? robotRaw.tpTriggerPx
    ),
    use_base_position: asNullableBoolean(robotRaw.use_base_position) ?? inferredGrid.use_base_position
  };
  return {
    account: {
      exchange: asString(accountRaw.exchange, "okx") as LiveSnapshotResponse["account"]["exchange"],
      symbol: asString(accountRaw.symbol, ""),
      exchange_symbol: asString(accountRaw.exchange_symbol, asString(accountRaw.symbol, "")),
      algo_id: asString(accountRaw.algo_id, ""),
      strategy_started_at: strategyStartedAt,
      fetched_at: fetchedAt,
      masked_api_key: asString(accountRaw.masked_api_key, "")
    },
    robot,
    monitoring,
    market_params: marketParamsRaw
      ? {
          source: asString(marketParamsRaw.source, "okx") as MarketParamsResponse["source"],
          symbol: asString(marketParamsRaw.symbol, ""),
          maker_fee_rate: asNumber(marketParamsRaw.maker_fee_rate),
          taker_fee_rate: asNumber(marketParamsRaw.taker_fee_rate),
          funding_rate_per_8h: asNumber(marketParamsRaw.funding_rate_per_8h),
          funding_interval_hours: asNumber(marketParamsRaw.funding_interval_hours, 8),
          price_tick_size: asNumber(marketParamsRaw.price_tick_size),
          quantity_step_size: asNumber(marketParamsRaw.quantity_step_size),
          min_notional: asNumber(marketParamsRaw.min_notional),
          reference_price:
            marketParamsRaw.reference_price === null || marketParamsRaw.reference_price === undefined
              ? marketParamsRaw.referencePrice === null || marketParamsRaw.referencePrice === undefined
                ? marketParamsRaw.mark_price === null || marketParamsRaw.mark_price === undefined
                  ? marketParamsRaw.markPrice === null || marketParamsRaw.markPrice === undefined
                    ? marketParamsRaw.last_price === null || marketParamsRaw.last_price === undefined
                      ? marketParamsRaw.lastPrice === null || marketParamsRaw.lastPrice === undefined
                        ? null
                        : asNumber(marketParamsRaw.lastPrice)
                      : asNumber(marketParamsRaw.last_price)
                    : asNumber(marketParamsRaw.markPrice)
                  : asNumber(marketParamsRaw.mark_price)
                : asNumber(marketParamsRaw.referencePrice)
              : asNumber(marketParamsRaw.reference_price),
          fetched_at: asString(marketParamsRaw.fetched_at, fetchedAt),
          note: asString(marketParamsRaw.note, "") || null
        }
      : null,
    summary,
    window: windowInfo,
    completeness,
    ledger_summary: ledgerSummary,
    position: {
      side: asString(positionRaw.side, "flat") as LivePosition["side"],
      quantity: asNumber(positionRaw.quantity),
      entry_price: asNumber(positionRaw.entry_price),
      mark_price: asNumber(positionRaw.mark_price),
      notional: asNumber(positionRaw.notional),
      leverage:
        positionRaw.leverage === null || positionRaw.leverage === undefined
          ? null
          : asNumber(positionRaw.leverage),
      liquidation_price:
        positionRaw.liquidation_price === null || positionRaw.liquidation_price === undefined
          ? null
          : asNumber(positionRaw.liquidation_price),
      margin_mode: asString(positionRaw.margin_mode, "") || null,
      unrealized_pnl: asNumber(positionRaw.unrealized_pnl),
      realized_pnl: asNumber(positionRaw.realized_pnl)
    },
    open_orders: Array.isArray(root.open_orders)
      ? (() => {
          const orders: LiveOpenOrder[] = [];
          root.open_orders.forEach((item) => {
            if (!isRecord(item)) {
              return;
            }
            orders.push({
              order_id: asString(item.order_id, "unknown"),
              client_order_id: asString(item.client_order_id, "") || null,
              side: asString(item.side, "buy") as LiveOpenOrder["side"],
              price: asNumber(item.price),
              quantity: asNumber(item.quantity),
              filled_quantity: asNumber(item.filled_quantity),
              reduce_only: asBoolean(item.reduce_only),
              status: asString(item.status, "open"),
              timestamp: asString(item.timestamp, "") || null
            });
          });
          return orders;
        })()
      : [],
    fills,
    funding_entries: fundingEntries,
    pnl_curve: normalizeCurvePoints(root.pnl_curve),
    daily_breakdown: dailyBreakdown,
    ledger_entries: ledgerEntries,
    inferred_grid: inferredGrid,
    diagnostics
  };
}

export async function fetchLiveRobotList(
  payload: LiveRobotListRequest,
  options?: RequestOptions
): Promise<LiveRobotListResponse> {
  const normalizedPayload: LiveRobotListRequest = {
    ...payload,
    scope: payload.scope ?? "running"
  };
  const raw = await requestJson<unknown>(
    "/api/v1/live/robots",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(normalizedPayload)
    },
    options
  );
  return normalizeLiveRobotListResponse(raw);
}

export async function fetchLiveSnapshot(
  payload: LiveSnapshotRequest,
  options?: RequestOptions
): Promise<LiveSnapshotResponse> {
  const normalizedPayload: LiveSnapshotRequest = {
    ...payload,
    monitoring_poll_interval_sec: payload.monitoring_poll_interval_sec ?? 15,
    monitoring_scope: payload.monitoring_scope ?? "running"
  };
  const raw = await requestJson<unknown>(
    "/api/v1/live/snapshot",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(normalizedPayload)
    },
    options
  );
  return normalizeLiveSnapshotResponse(raw);
}
