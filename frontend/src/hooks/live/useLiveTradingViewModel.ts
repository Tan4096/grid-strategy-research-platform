import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { buildLivePnlCurve } from "../../lib/livePnlCurve";
import { buildLiveMonitoringHeadline } from "../../lib/liveMonitoringUx";
import { DRAWDOWN_CURVE_COLOR } from "../../lib/curveColors";
import type { BacktestRequest, LiveDiagnostic, LiveLedgerEntry, LiveMonitoringTrendPoint, LiveSnapshotResponse } from "../../types";
import {
  type LedgerKindFilter,
  type LedgerMakerFilter,
  type LedgerPreset,
  type LedgerSideFilter,
  type LedgerTimeFilter,
  type LedgerView,
  buildMonitoringGapSummary,
  dataStatusMeta,
  groupDiagnostics,
  integrityLevelMeta,
  pickPositiveValue,
  riskLevelMeta,
  robotDirectionLabel,
  robotStateLabel
} from "../../components/live-trading/shared";

interface Params {
  request: BacktestRequest;
  snapshot: LiveSnapshotResponse | null;
  autoRefreshPaused: boolean;
  trend: LiveMonitoringTrendPoint[];
}

export interface LiveTradingViewModel {
  snapshot: LiveSnapshotResponse | null;
  robot: LiveSnapshotResponse["robot"] | null;
  monitoring: LiveSnapshotResponse["monitoring"] | null;
  windowInfo: LiveSnapshotResponse["window"] | null;
  completeness: LiveSnapshotResponse["completeness"] | null;
  ledgerSummary: LiveSnapshotResponse["ledger_summary"] | null;
  dailyBreakdown: LiveSnapshotResponse["daily_breakdown"];
  ledgerEntries: LiveSnapshotResponse["ledger_entries"];
  diagnosticsByLevel: Record<LiveDiagnostic["level"], LiveDiagnostic[]>;
  syncStatus: "failed" | "partial" | "ready";
  coverageScore: number;
  currentNotional: number;
  currentPrice: number | null;
  gapSummary: string;
  headline: ReturnType<typeof buildLiveMonitoringHeadline> | null;
  riskMeta: ReturnType<typeof riskLevelMeta> | null;
  integrityMeta: ReturnType<typeof integrityLevelMeta> | null;
  dataStatus: ReturnType<typeof dataStatusMeta> | null;
  pnlCurve: ReturnType<typeof buildLivePnlCurve> | null;
  pnlCurveDelta: number | null;
  pnlCurveDisplayStart: string | null;
  pnlCurveReturnPct: number | null;
  pnlCurveDeltaPct: number | null;
  pnlCurveChartUsesReturnRate: boolean;
  pnlCurveColor: string;
  pnlCurveChartData: Array<{ timestamp: string; value: number }>;
  pnlCurveDrawdown: number | null;
  pnlCurveMaxDrawdown: number | null;
  pnlCurveDrawdownChartData: Array<{ timestamp: string; value: number }>;
  pnlCurveDrawdownColor: string;
  pnlCurveChartHeight: number;
  filteredEntries: LiveLedgerEntry[];
  presetCounts: Record<LedgerPreset, number>;
  stateBadge: ReturnType<typeof robotStateLabel> | null;
  directionBadge: ReturnType<typeof robotDirectionLabel> | null;
  ledgerView: LedgerView;
  setLedgerView: Dispatch<SetStateAction<LedgerView>>;
  ledgerPreset: LedgerPreset;
  setLedgerPreset: Dispatch<SetStateAction<LedgerPreset>>;
  kindFilter: LedgerKindFilter;
  setKindFilter: Dispatch<SetStateAction<LedgerKindFilter>>;
  sideFilter: LedgerSideFilter;
  setSideFilter: Dispatch<SetStateAction<LedgerSideFilter>>;
  makerFilter: LedgerMakerFilter;
  setMakerFilter: Dispatch<SetStateAction<LedgerMakerFilter>>;
  timeFilter: LedgerTimeFilter;
  setTimeFilter: Dispatch<SetStateAction<LedgerTimeFilter>>;
  realizedOnly: boolean;
  setRealizedOnly: Dispatch<SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
}

export function useLiveTradingViewModel({
  request,
  snapshot,
  autoRefreshPaused,
  trend
}: Params): LiveTradingViewModel {
  const [ledgerView, setLedgerView] = useState<LedgerView>("summary");
  const [ledgerPreset, setLedgerPreset] = useState<LedgerPreset>("all");
  const [kindFilter, setKindFilter] = useState<LedgerKindFilter>("all");
  const [sideFilter, setSideFilter] = useState<LedgerSideFilter>("all");
  const [makerFilter, setMakerFilter] = useState<LedgerMakerFilter>("all");
  const [timeFilter, setTimeFilter] = useState<LedgerTimeFilter>("all");
  const [realizedOnly, setRealizedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  void request;
  const pnlCurve = useMemo(() => (snapshot ? buildLivePnlCurve(snapshot, trend) : null), [snapshot, trend]);

  const robot = snapshot?.robot ?? null;
  const monitoring = snapshot?.monitoring ?? null;
  const windowInfo = useMemo(
    () =>
      snapshot?.window
        ? snapshot.window
        : snapshot
          ? {
              strategy_started_at: snapshot.account.strategy_started_at,
              fetched_at: snapshot.account.fetched_at,
              compared_end_at: snapshot.account.fetched_at
            }
          : null,
    [snapshot]
  );
  const completeness = useMemo(
    () =>
      snapshot?.completeness
        ? snapshot.completeness
        : snapshot
          ? {
              fills_complete: false,
              funding_complete: false,
              bills_window_clipped: false,
              partial_failures: []
            }
          : null,
    [snapshot]
  );
  const ledgerSummary = useMemo(
    () =>
      snapshot?.ledger_summary
        ? snapshot.ledger_summary
        : snapshot
          ? {
              trading_net:
                snapshot.summary.total_pnl -
                snapshot.summary.unrealized_pnl -
                snapshot.summary.funding_net,
              fees: snapshot.summary.fees_paid,
              funding: snapshot.summary.funding_net,
              total_pnl: snapshot.summary.total_pnl,
              realized: snapshot.summary.realized_pnl,
              unrealized: snapshot.summary.unrealized_pnl
            }
          : null,
    [snapshot]
  );
  const dailyBreakdown = useMemo(() => snapshot?.daily_breakdown ?? [], [snapshot]);
  const ledgerEntries = useMemo(() => snapshot?.ledger_entries ?? [], [snapshot]);
  const diagnosticsByLevel = groupDiagnostics(snapshot?.diagnostics ?? []);
  const syncStatus: "failed" | "partial" | "ready" = snapshot && completeness
    ? completeness.partial_failures.length > 0 ||
      snapshot.diagnostics.some((item) => item.level === "warning")
        ? "partial"
        : "ready"
    : "failed";
  const coverageScore =
    completeness && snapshot
      ? [
          completeness.fills_complete,
          completeness.funding_complete,
          !completeness.bills_window_clipped
        ].filter(Boolean).length / 3
      : 0;
  const currentNotional =
    snapshot?.position.notional || snapshot?.summary.position_notional || 0;
  const currentPrice = snapshot
    ? pickPositiveValue(
        snapshot.market_params?.reference_price,
        snapshot.position.mark_price,
        snapshot.position.entry_price
      )
    : null;
  const gapSummary = snapshot ? buildMonitoringGapSummary(snapshot) : "";
  const headline = snapshot ? buildLiveMonitoringHeadline(snapshot) : null;
  const riskMeta = headline ? riskLevelMeta(headline.riskLevel) : null;
  const integrityMeta = headline ? integrityLevelMeta(headline.integrityLevel) : null;
  const dataStatus =
    monitoring && headline ? dataStatusMeta(monitoring.stale, autoRefreshPaused) : null;
  const pnlCurveDelta = pnlCurve?.deltaFromPrevious ?? null;
  const pnlCurveDisplayStart =
    pnlCurve?.points[0]?.timestamp ?? windowInfo?.strategy_started_at ?? null;
  const pnlCurvePctScale = useMemo(() => {
    if (!pnlCurve || !robot) {
      return null;
    }

    if (
      typeof robot.pnl_ratio === "number" &&
      Number.isFinite(robot.pnl_ratio) &&
      Math.abs(pnlCurve.latestValue) > 1e-9
    ) {
      return (robot.pnl_ratio * 100) / pnlCurve.latestValue;
    }

    if (
      robot.investment_usdt &&
      Number.isFinite(robot.investment_usdt) &&
      Math.abs(robot.investment_usdt) > 1e-9
    ) {
      return 100 / robot.investment_usdt;
    }

    return null;
  }, [pnlCurve, robot]);
  const pnlCurveReturnPct =
    pnlCurve && pnlCurvePctScale !== null
      ? pnlCurve.latestValue * pnlCurvePctScale
      : null;
  const pnlCurveDeltaPct =
    pnlCurveDelta !== null && pnlCurvePctScale !== null
      ? pnlCurveDelta * pnlCurvePctScale
      : null;
  const pnlCurveChartUsesReturnRate = pnlCurvePctScale !== null;
  const pnlCurveColorSignal = pnlCurveChartUsesReturnRate
    ? pnlCurveReturnPct ?? 0
    : pnlCurve?.latestValue ?? 0;
  const pnlCurveColor = pnlCurveColorSignal >= 0 ? "#84cc16" : "#f87171";
  const pnlCurveChartData = useMemo(
    () =>
      (pnlCurve?.points ?? []).map((point) => ({
        timestamp: point.timestamp,
        value: pnlCurveChartUsesReturnRate && pnlCurvePctScale !== null ? point.value * pnlCurvePctScale : point.value
      })),
    [pnlCurve?.points, pnlCurveChartUsesReturnRate, pnlCurvePctScale]
  );
  const pnlCurveDrawdownChartData = useMemo(() => {
    let runningPeak = Number.NEGATIVE_INFINITY;
    return pnlCurveChartData.map((point) => {
      runningPeak = Math.max(runningPeak, point.value);
      return {
        timestamp: point.timestamp,
        value: runningPeak - point.value > 1e-9 ? point.value - runningPeak : 0
      };
    });
  }, [pnlCurveChartData]);
  const pnlCurveDrawdown =
    pnlCurveDrawdownChartData.length > 0 ? pnlCurveDrawdownChartData[pnlCurveDrawdownChartData.length - 1]?.value ?? null : null;
  const pnlCurveMaxDrawdown =
    pnlCurveDrawdownChartData.length > 0
      ? pnlCurveDrawdownChartData.reduce((min, point) => Math.min(min, point.value), 0)
      : null;
  const pnlCurveDrawdownColor = DRAWDOWN_CURVE_COLOR;
  const pnlCurveChartHeight = pnlCurve
    ? Math.round(
        Math.max(280, Math.min(360, 280 + Math.log2(Math.max(2, pnlCurve.points.length)) * 16))
      )
    : 300;

  const filteredEntries = useMemo(() => {
    if (!windowInfo) {
      return [];
    }
    const now = Date.parse(windowInfo.fetched_at);
    return ledgerEntries.filter((entry) => {
      if (ledgerPreset === "trades" && entry.kind !== "trade") {
        return false;
      }
      if (ledgerPreset === "fees" && entry.kind !== "fee") {
        return false;
      }
      if (ledgerPreset === "funding" && entry.kind !== "funding") {
        return false;
      }
      if (kindFilter !== "all" && entry.kind !== kindFilter) {
        return false;
      }
      if (sideFilter !== "all" && entry.side !== sideFilter) {
        return false;
      }
      if (makerFilter === "maker" && entry.is_maker !== true) {
        return false;
      }
      if (makerFilter === "taker" && entry.is_maker !== false) {
        return false;
      }
      if (realizedOnly && entry.pnl === 0) {
        return false;
      }
      if (searchQuery.trim()) {
        const haystack = [
          entry.note,
          entry.currency,
          entry.side,
          entry.order_id,
          entry.trade_id,
          entry.kind,
          entry.timestamp
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(searchQuery.trim().toLowerCase())) {
          return false;
        }
      }
      if (timeFilter !== "all") {
        const hours = timeFilter === "24h" ? 24 : timeFilter === "7d" ? 24 * 7 : 24 * 30;
        if (now - Date.parse(entry.timestamp) > hours * 3600 * 1000) {
          return false;
        }
      }
      return true;
    });
  }, [
    kindFilter,
    ledgerEntries,
    ledgerPreset,
    makerFilter,
    realizedOnly,
    searchQuery,
    sideFilter,
    timeFilter,
    windowInfo
  ]);

  const presetCounts = useMemo(
    () => ({
      all: ledgerEntries.length,
      trades: ledgerEntries.filter((entry) => entry.kind === "trade").length,
      fees: ledgerEntries.filter((entry) => entry.kind === "fee").length,
      funding: ledgerEntries.filter((entry) => entry.kind === "funding").length
    }),
    [ledgerEntries]
  );

  const stateBadge = robot ? robotStateLabel(robot.state) : null;
  const directionBadge = robot ? robotDirectionLabel(robot.direction) : null;

  return {
    snapshot,
    robot,
    monitoring,
    windowInfo,
    completeness,
    ledgerSummary,
    dailyBreakdown,
    ledgerEntries,
    diagnosticsByLevel,
    syncStatus,
    coverageScore,
    currentNotional,
    currentPrice,
    gapSummary,
    headline,
    riskMeta,
    integrityMeta,
    dataStatus,
    pnlCurve,
    pnlCurveDelta,
    pnlCurveDisplayStart,
    pnlCurveReturnPct,
    pnlCurveDeltaPct,
    pnlCurveChartUsesReturnRate,
    pnlCurveColor,
    pnlCurveChartData,
    pnlCurveDrawdown,
    pnlCurveMaxDrawdown,
    pnlCurveDrawdownChartData,
    pnlCurveDrawdownColor,
    pnlCurveChartHeight,
    filteredEntries,
    presetCounts,
    stateBadge,
    directionBadge,
    ledgerView,
    setLedgerView,
    ledgerPreset,
    setLedgerPreset,
    kindFilter,
    setKindFilter,
    sideFilter,
    setSideFilter,
    makerFilter,
    setMakerFilter,
    timeFilter,
    setTimeFilter,
    realizedOnly,
    setRealizedOnly,
    searchQuery,
    setSearchQuery
  };
}
