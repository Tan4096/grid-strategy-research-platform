import {
  LiveFill,
  LiveOpenOrder,
  LiveSnapshotResponse,
  OperationEventCategory,
  OperationEventKind,
  OperationEventStatus
} from "../types";
import { NOTICE_ADVICE, buildNoticeDetail } from "./notificationCopy";
import { buildLiveMonitoringHeadline, type LiveMonitoringAttentionItem } from "./liveMonitoringUx";

export interface LiveMonitoringNotification {
  id?: string;
  dismiss?: boolean;
  kind?: OperationEventKind;
  delivery: "center" | "toast";
  action: string;
  title: string;
  detail: string;
  category: OperationEventCategory;
  status: OperationEventStatus;
  source: "live_trading";
}

type FillLifecycle = "open" | "close" | "trade";

const SIGNIFICANT_NOTIONAL_DELTA_MIN = 500;
const SIGNIFICANT_NOTIONAL_DELTA_RATIO = 0.25;
const SIGNIFICANT_PNL_DELTA_MIN = 50;
const SIGNIFICANT_PNL_DELTA_RATIO = 0.05;
const SYNC_ATTENTION_KEYS = new Set(["stale", "orders_unavailable", "liquidation_risk", "stop_loss_risk"]);

function formatNumber(value: number | null | undefined, digits = 2): string {
  return value !== null && value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function formatSignedNumber(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatPriceRange(orders: LiveOpenOrder[]): string {
  if (!orders.length) {
    return "--";
  }
  const prices = orders.map((item) => item.price).filter((item) => Number.isFinite(item));
  if (!prices.length) {
    return "--";
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatNumber(min) : `${formatNumber(min)} ~ ${formatNumber(max)}`;
}

function orderKey(order: LiveOpenOrder): string {
  return [order.order_id, order.client_order_id ?? "", order.price, order.quantity].join("|");
}

function fillKey(fill: LiveFill): string {
  return [fill.trade_id, fill.order_id ?? "", fill.timestamp].join("|");
}

function _buildDistancePct(markPrice: number | null | undefined, triggerPrice: number | null | undefined): number | null {
  if (!markPrice || !triggerPrice || !Number.isFinite(markPrice) || !Number.isFinite(triggerPrice)) {
    return null;
  }
  return Math.abs(((triggerPrice - markPrice) / markPrice) * 100);
}

function _deriveReferencePrice(snapshot: LiveSnapshotResponse): number | null {
  const apiPrice = snapshot.market_params?.reference_price;
  if (apiPrice && Number.isFinite(apiPrice) && apiPrice > 0) {
    return apiPrice;
  }

  const directCandidates = [snapshot.position.mark_price, snapshot.position.entry_price];
  for (const candidate of directCandidates) {
    if (candidate && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }

  const quantity = snapshot.position.quantity;
  const notional = snapshot.position.notional || snapshot.summary.position_notional;
  if (quantity && Number.isFinite(quantity) && quantity > 0 && notional && Number.isFinite(notional) && notional > 0) {
    return Math.abs(notional / quantity);
  }

  return null;
}

function inferFillLifecycle(fill: LiveFill, snapshot: LiveSnapshotResponse): FillLifecycle {
  const direction = (snapshot.position.side === "flat" ? snapshot.robot.direction : snapshot.position.side) ?? null;
  if (direction === "long") {
    return fill.side === "buy" ? "open" : "close";
  }
  if (direction === "short") {
    return fill.side === "sell" ? "open" : "close";
  }
  if (fill.realized_pnl !== 0) {
    return "close";
  }
  return "trade";
}

function buildFillNotification(snapshot: LiveSnapshotResponse, fills: LiveFill[], lifecycle: FillLifecycle): LiveMonitoringNotification | null {
  if (!fills.length) {
    return null;
  }
  const latestFill = [...fills].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const totalQuantity = fills.reduce((sum, item) => sum + item.quantity, 0);
  const totalRealizedPnl = fills.reduce((sum, item) => sum + item.realized_pnl, 0);
  const totalFee = fills.reduce((sum, item) => sum + item.fee, 0);
  const lifecycleLabel = lifecycle === "open" ? "开仓" : lifecycle === "close" ? "平仓" : "成交";
  const title = lifecycle === "trade" ? "成交更新" : `网格${lifecycleLabel}`;
  const detail = fills.length === 1
    ? buildNoticeDetail(
        snapshot.account.symbol,
        `${lifecycleLabel} ${latestFill.side.toUpperCase()} ${formatNumber(latestFill.quantity, 4)} @ ${formatNumber(latestFill.price)}，已实现 ${formatSignedNumber(latestFill.realized_pnl)} USDT，手续费 ${formatNumber(latestFill.fee, 4)}`,
        NOTICE_ADVICE.watchRuntime
      )
    : buildNoticeDetail(
        snapshot.account.symbol,
        `新增 ${fills.length} 笔${lifecycleLabel}成交，合计数量 ${formatNumber(totalQuantity, 4)}，已实现 ${formatSignedNumber(totalRealizedPnl)} USDT，手续费 ${formatNumber(totalFee, 4)}`,
        NOTICE_ADVICE.watchRuntime
      );
  return {
    delivery: "toast",
    action: lifecycle === "open" ? "live_fill_open" : lifecycle === "close" ? "live_fill_close" : "live_fill_trade",
    title,
    detail,
    category: lifecycle === "close" && totalRealizedPnl < 0 ? "warning" : "success",
    status: "success",
    source: "live_trading"
  };
}

function buildOpenOrderNotifications(previous: LiveSnapshotResponse, next: LiveSnapshotResponse): LiveMonitoringNotification[] {
  const previousKeys = new Set(previous.open_orders.map((item) => orderKey(item)));
  const nextKeys = new Set(next.open_orders.map((item) => orderKey(item)));
  const addedOrders = next.open_orders.filter((item) => !previousKeys.has(orderKey(item)));
  const removedOrders = previous.open_orders.filter((item) => !nextKeys.has(orderKey(item)));
  const notifications: LiveMonitoringNotification[] = [];

  if (addedOrders.length > 0) {
    notifications.push({
      delivery: "toast",
      action: "live_open_orders_added",
      title: "挂单新增",
      detail: buildNoticeDetail(next.account.symbol, `新增 ${addedOrders.length} 笔挂单，价格区间 ${formatPriceRange(addedOrders)}`, NOTICE_ADVICE.watchRuntime),
      category: "info",
      status: "success",
      source: "live_trading"
    });
  }

  if (removedOrders.length > 0) {
    notifications.push({
      delivery: "toast",
      action: "live_open_orders_removed",
      title: "挂单减少",
      detail: buildNoticeDetail(next.account.symbol, `减少 ${removedOrders.length} 笔挂单，价格区间 ${formatPriceRange(removedOrders)}`, NOTICE_ADVICE.watchRuntime),
      category: "info",
      status: "success",
      source: "live_trading"
    });
  }

  return notifications;
}

function buildRobotStateNotification(previous: LiveSnapshotResponse, next: LiveSnapshotResponse): LiveMonitoringNotification | null {
  const previousState = (previous.robot.state ?? "").trim().toLowerCase();
  const nextState = (next.robot.state ?? "").trim().toLowerCase();
  if (!previousState || !nextState || previousState === nextState) {
    return null;
  }
  const isWarningState = nextState === "stopped" || nextState === "paused" || nextState === "stop_pending" || nextState === "stopping";
  return {
    delivery: "center",
    kind: "history",
    action: "live_robot_state_changed",
    title: "机器人状态变更",
    detail: buildNoticeDetail(next.robot.name, `状态 ${previous.robot.state ?? "未知"} → ${next.robot.state ?? "未知"}`, NOTICE_ADVICE.watchRuntime),
    category: isWarningState ? "warning" : "info",
    status: isWarningState ? "partial_failed" : "success",
    source: "live_trading"
  };
}

function buildPositionNotifications(previous: LiveSnapshotResponse, next: LiveSnapshotResponse): LiveMonitoringNotification[] {
  const notifications: LiveMonitoringNotification[] = [];
  if (previous.position.side !== next.position.side) {
    notifications.push({
      delivery: "center",
      kind: "history",
      action: "live_position_side_changed",
      title: "持仓方向变更",
      detail: buildNoticeDetail(next.account.symbol, `持仓 ${previous.position.side} → ${next.position.side}`, NOTICE_ADVICE.watchRuntime),
      category: next.position.side === "flat" ? "warning" : "info",
      status: next.position.side === "flat" ? "partial_failed" : "success",
      source: "live_trading"
    });
  }

  const previousNotional = Math.abs(previous.position.notional || previous.summary.position_notional || 0);
  const nextNotional = Math.abs(next.position.notional || next.summary.position_notional || 0);
  const notionalDelta = nextNotional - previousNotional;
  const notionalThreshold = Math.max(SIGNIFICANT_NOTIONAL_DELTA_MIN, previousNotional * SIGNIFICANT_NOTIONAL_DELTA_RATIO);
  if (Math.abs(notionalDelta) >= notionalThreshold) {
    notifications.push({
      delivery: "toast",
      action: "live_position_notional_shift",
      title: "敞口变动",
      detail: buildNoticeDetail(next.account.symbol, `名义敞口变化 ${formatSignedNumber(notionalDelta)} USDT，当前 ${formatNumber(nextNotional)} USDT`, NOTICE_ADVICE.reviewParams),
      category: "warning",
      status: "partial_failed",
      source: "live_trading"
    });
  }

  return notifications;
}

function buildPnlNotification(previous: LiveSnapshotResponse, next: LiveSnapshotResponse): LiveMonitoringNotification | null {
  const previousTotalPnl = previous.robot.total_pnl ?? previous.summary.total_pnl;
  const nextTotalPnl = next.robot.total_pnl ?? next.summary.total_pnl;
  const pnlDelta = nextTotalPnl - previousTotalPnl;
  const investment = next.robot.investment_usdt ?? previous.robot.investment_usdt ?? 0;
  const threshold = Math.max(SIGNIFICANT_PNL_DELTA_MIN, investment * SIGNIFICANT_PNL_DELTA_RATIO);
  if (Math.abs(pnlDelta) < threshold) {
    return null;
  }
  return {
    delivery: "toast",
    action: "live_total_pnl_shift",
    title: pnlDelta >= 0 ? "收益抬升" : "收益回撤",
    detail: buildNoticeDetail(next.account.symbol, `总收益变化 ${formatSignedNumber(pnlDelta)} USDT，当前 ${formatNumber(nextTotalPnl)} USDT`, pnlDelta >= 0 ? NOTICE_ADVICE.watchRuntime : NOTICE_ADVICE.reviewParams),
    category: pnlDelta >= 0 ? "success" : "warning",
    status: pnlDelta >= 0 ? "success" : "partial_failed",
    source: "live_trading"
  };
}

function buildSyncAttentionId(key: string): string {
  return `live-sync:${key}`;
}

function categoryFromAttentionSeverity(severity: LiveMonitoringAttentionItem["severity"]): OperationEventCategory {
  if (severity === "danger") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "info";
}

function statusFromAttentionSeverity(severity: LiveMonitoringAttentionItem["severity"]): OperationEventStatus {
  if (severity === "danger") {
    return "failed";
  }
  if (severity === "warning") {
    return "partial_failed";
  }
  return "success";
}

function buildSyncedAttentionDetail(key: string, next: LiveSnapshotResponse, item: LiveMonitoringAttentionItem): string {
  if (key === "stale") {
    return buildNoticeDetail(next.account.symbol, "当前展示最近一次成功快照", NOTICE_ADVICE.retryLater);
  }
  if (key === "orders_unavailable") {
    return buildNoticeDetail(next.account.symbol, "挂单抓取失败，挂单状态与账单判断可能失真", NOTICE_ADVICE.retryLater);
  }
  if (key === "liquidation_risk") {
    return buildNoticeDetail(next.account.symbol, item.message.split("，")[0] ?? item.message, NOTICE_ADVICE.reviewParams);
  }
  if (key === "stop_loss_risk") {
    return buildNoticeDetail(next.account.symbol, item.message.split("，")[0] ?? item.message, NOTICE_ADVICE.reviewParams);
  }
  return buildNoticeDetail(next.account.symbol, item.message, NOTICE_ADVICE.watchRuntime);
}

function buildSyncedAttentionNotifications(next: LiveSnapshotResponse): LiveMonitoringNotification[] {
  const nextItems = buildLiveMonitoringHeadline(next).attentionItems;
  const nextMap = new Map(nextItems.map((item) => [item.key, item]));
  const notifications: LiveMonitoringNotification[] = [];

  SYNC_ATTENTION_KEYS.forEach((key) => {
    const nextItem = nextMap.get(key) ?? null;
    if (nextItem) {
      notifications.push({
        id: buildSyncAttentionId(key),
        delivery: "center",
        kind: "state",
        action: `live_attention_${key}`,
        title: nextItem.title,
        detail: buildSyncedAttentionDetail(key, next, nextItem),
        category: categoryFromAttentionSeverity(nextItem.severity),
        status: statusFromAttentionSeverity(nextItem.severity),
        source: "live_trading"
      });
      return;
    }
    notifications.push({
      id: buildSyncAttentionId(key),
      dismiss: true,
      delivery: "center",
      kind: "state",
      action: `live_attention_${key}`,
      title: "",
      detail: "",
      category: "info",
      status: "success",
      source: "live_trading"
    });
  });

  return notifications;
}

export function detectLiveMonitoringNotifications(previous: LiveSnapshotResponse | null, next: LiveSnapshotResponse): LiveMonitoringNotification[] {
  if (!previous) {
    return buildSyncedAttentionNotifications(next);
  }

  const notifications: LiveMonitoringNotification[] = [];
  const previousFillKeys = new Set(previous.fills.map((item) => fillKey(item)));
  const newFills = next.fills.filter((item) => !previousFillKeys.has(fillKey(item)));
  const groupedFills = new Map<FillLifecycle, LiveFill[]>();
  newFills.forEach((fill) => {
    const lifecycle = inferFillLifecycle(fill, next);
    groupedFills.set(lifecycle, [...(groupedFills.get(lifecycle) ?? []), fill]);
  });
  groupedFills.forEach((fills, lifecycle) => {
    const notification = buildFillNotification(next, fills, lifecycle);
    if (notification) {
      notifications.push(notification);
    }
  });

  notifications.push(...buildOpenOrderNotifications(previous, next));

  const robotStateNotification = buildRobotStateNotification(previous, next);
  if (robotStateNotification) {
    notifications.push(robotStateNotification);
  }

  notifications.push(...buildPositionNotifications(previous, next));

  const pnlNotification = buildPnlNotification(previous, next);
  if (pnlNotification) {
    notifications.push(pnlNotification);
  }

  notifications.push(...buildSyncedAttentionNotifications(next));

  return notifications;
}
