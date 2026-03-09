from __future__ import annotations

from datetime import datetime
from typing import Callable

from app.core.schemas import CurvePoint, LiveAccountInfo, LiveRobotOverview, LiveSnapshotRequest, LiveSnapshotResponse, LiveWindowInfo
from app.services.data_loader import DataLoadError
from app.services.live_snapshot_types import LiveSnapshotError


def fetch_live_snapshot_aggregate(
    payload: LiveSnapshotRequest,
    *,
    cache_key: str,
    cache_snapshot_store: dict[str, tuple[float, object]],
    cache_get_fresh,
    cache_get_any,
    cache_set,
    snapshot_cache_ttl_sec: float,
    retry_live_action,
    fetch_okx_bot_snapshot: Callable,
    fetch_market_params_best_effort: Callable,
    infer_grid,
    utc_now,
    floor_to_minute,
    resolve_effective_strategy_started_at,
    build_summary,
    build_ledger_entries,
    build_daily_breakdown,
    build_ledger_summary,
    build_completeness,
    build_monitoring_info,
    normalize_datetime,
    normalize_diagnostics,
    mask_api_key,
    build_live_simulated_pnl_curve: Callable,
    build_live_pnl_curve: Callable,
    diag,
    sanitize_error_message,
    pick_positive_value,
) -> LiveSnapshotResponse:
    cached = cache_get_fresh(cache_snapshot_store, cache_key, snapshot_cache_ttl_sec)
    if cached is not None:
        cached_monitoring = build_monitoring_info(
            poll_interval_sec=payload.monitoring_poll_interval_sec,
            last_success_at=cached.monitoring.last_success_at,
            source_latency_ms=cached.monitoring.source_latency_ms,
            fills_page_count=cached.monitoring.fills_page_count,
            fills_capped=cached.monitoring.fills_capped,
            orders_page_count=cached.monitoring.orders_page_count,
            stale=False,
        )
        return cached.model_copy(update={"monitoring": cached_monitoring}, deep=True)

    try:
        exchange_snapshot = retry_live_action(lambda: fetch_okx_bot_snapshot(payload), retries=2)
        diagnostics = list(exchange_snapshot.diagnostics)
        market_params = fetch_market_params_best_effort(payload.exchange, payload.symbol, diagnostics)
        inferred_grid = exchange_snapshot.inferred_grid or infer_grid(exchange_snapshot.position, exchange_snapshot.open_orders)
        fetched_at = utc_now()
        compared_end_at = floor_to_minute(fetched_at)
        effective_strategy_started_at = resolve_effective_strategy_started_at(
            payload.strategy_started_at,
            exchange_snapshot.robot.created_at if exchange_snapshot.robot is not None else None,
        )
        summary = exchange_snapshot.summary or build_summary(
            position=exchange_snapshot.position,
            open_orders=exchange_snapshot.open_orders,
            fills=exchange_snapshot.fills,
            funding_entries=exchange_snapshot.funding_entries,
        )
        ledger_entries = exchange_snapshot.ledger_entries or build_ledger_entries(exchange_snapshot.fills, exchange_snapshot.funding_entries)
        daily_breakdown = build_daily_breakdown(ledger_entries)
        ledger_summary = build_ledger_summary(summary)
        fills_incomplete = any(
            item.code in {"fills_truncated", "fills_not_available", "LIVE_BOT_FILLS_CAPPED"}
            for item in diagnostics
        )
        if fills_incomplete:
            diagnostics.append(
                diag(
                    "warning",
                    "pnl_curve_fills_incomplete",
                    "成交记录不完整，当前无法可靠按 OKX 历史价格 K 线回放全程收益曲线。",
                )
            )
        pnl_curve: list[CurvePoint] = []
        try:
            pnl_curve = build_live_simulated_pnl_curve(
                symbol=exchange_snapshot.exchange_symbol or payload.symbol,
                strategy_started_at=effective_strategy_started_at,
                fetched_at=fetched_at,
                position=exchange_snapshot.position,
                robot=exchange_snapshot.robot,
                inferred_grid=inferred_grid,
                market_params=market_params,
                total_pnl=summary.total_pnl,
            )
            if pnl_curve:
                diagnostics.append(
                    diag(
                        "info",
                        "pnl_curve_simulated",
                        "实盘收益曲线已按 OKX 历史价格 K 线逐 K 模拟重建，并按当前实盘收益归一到最新快照。",
                    )
                )
        except (DataLoadError, ValueError) as exc:
            diagnostics.append(
                diag(
                    "warning",
                    "pnl_curve_simulation_unavailable",
                    f"逐 K 模拟收益曲线失败：{sanitize_error_message(str(exc))}",
                )
            )

        if not pnl_curve and not fills_incomplete:
            try:
                pnl_curve = build_live_pnl_curve(
                    symbol=exchange_snapshot.exchange_symbol or payload.symbol,
                    strategy_started_at=effective_strategy_started_at,
                    fetched_at=fetched_at,
                    fills=exchange_snapshot.fills,
                    funding_entries=exchange_snapshot.funding_entries,
                    total_pnl=summary.total_pnl,
                    current_mark_price=pick_positive_value(
                        market_params.reference_price if market_params is not None else None,
                        exchange_snapshot.position.mark_price,
                    ),
                    current_unrealized_pnl=summary.unrealized_pnl,
                )
                if pnl_curve:
                    diagnostics.append(
                        diag(
                            "info",
                            "pnl_curve_replay_available",
                            "实盘收益曲线已按 OKX 历史标记价格 K 线与成交/资金费回放重建。",
                        )
                    )
            except DataLoadError as replay_exc:
                diagnostics.append(
                    diag(
                        "warning",
                        "pnl_curve_kline_unavailable",
                        f"OKX 历史标记价格 K 线加载失败，未生成回放收益曲线：{sanitize_error_message(str(replay_exc))}",
                    )
                )
        diagnostics = normalize_diagnostics(diagnostics)
        completeness = build_completeness(diagnostics)
        response = LiveSnapshotResponse(
            account=LiveAccountInfo(
                exchange=payload.exchange,
                symbol=exchange_snapshot.symbol or payload.symbol,
                exchange_symbol=exchange_snapshot.exchange_symbol,
                algo_id=payload.algo_id or "",
                strategy_started_at=normalize_datetime(effective_strategy_started_at),
                fetched_at=fetched_at,
                masked_api_key=mask_api_key(payload.credentials.api_key),
            ),
            robot=exchange_snapshot.robot
            or LiveRobotOverview(
                algo_id=payload.algo_id or "",
                name=f"{exchange_snapshot.exchange_symbol} · {(payload.algo_id or '')[-6:]}",
                direction=exchange_snapshot.position.side,
                liquidation_price=exchange_snapshot.position.liquidation_price,
                grid_count=inferred_grid.grid_count,
                lower_price=inferred_grid.lower,
                upper_price=inferred_grid.upper,
                grid_spacing=inferred_grid.grid_spacing,
                total_pnl=summary.total_pnl,
                use_base_position=inferred_grid.use_base_position,
            ),
            monitoring=build_monitoring_info(
                poll_interval_sec=payload.monitoring_poll_interval_sec,
                last_success_at=fetched_at,
                source_latency_ms=exchange_snapshot.source_latency_ms,
                fills_page_count=exchange_snapshot.fills_page_count,
                fills_capped=exchange_snapshot.fills_capped,
                orders_page_count=exchange_snapshot.orders_page_count,
                stale=False,
            ),
            market_params=market_params,
            summary=summary,
            window=LiveWindowInfo(
                strategy_started_at=normalize_datetime(effective_strategy_started_at),
                fetched_at=fetched_at,
                compared_end_at=compared_end_at,
            ),
            completeness=completeness,
            ledger_summary=ledger_summary,
            position=exchange_snapshot.position,
            open_orders=exchange_snapshot.open_orders,
            fills=exchange_snapshot.fills,
            funding_entries=exchange_snapshot.funding_entries,
            pnl_curve=pnl_curve,
            daily_breakdown=daily_breakdown,
            ledger_entries=ledger_entries,
            inferred_grid=inferred_grid,
            diagnostics=diagnostics,
        )
        cache_set(cache_snapshot_store, cache_key, response)
        return response
    except LiveSnapshotError:
        cached_any = cache_get_any(cache_snapshot_store, cache_key)
        if cached_any is None:
            raise
        stale_diagnostics = list(cached_any.diagnostics)
        if not any(item.code == "LIVE_BOT_SNAPSHOT_STALE" for item in stale_diagnostics):
            stale_diagnostics.append(diag("warning", "LIVE_BOT_SNAPSHOT_STALE", "本次监测刷新失败，当前仍显示上一次成功结果。"))
        stale_response = cached_any.model_copy(
            update={
                "monitoring": build_monitoring_info(
                    poll_interval_sec=payload.monitoring_poll_interval_sec,
                    last_success_at=cached_any.monitoring.last_success_at,
                    source_latency_ms=cached_any.monitoring.source_latency_ms,
                    fills_page_count=cached_any.monitoring.fills_page_count,
                    fills_capped=cached_any.monitoring.fills_capped,
                    orders_page_count=cached_any.monitoring.orders_page_count,
                    stale=True,
                ),
                "diagnostics": stale_diagnostics,
                "completeness": build_completeness(stale_diagnostics),
            },
            deep=True,
        )
        return stale_response
