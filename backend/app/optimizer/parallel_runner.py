from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from multiprocessing import get_context
from typing import Any, Callable, Dict, Iterable, List, Optional

from app.core.optimization_schemas import OptimizationTarget
from app.core.schemas import Candle, GridSide
from app.optimizer.scoring import compute_return_drawdown_ratio, compute_score, compute_sharpe_ratio_from_values
from app.services.backtest_engine import run_backtest_for_optimization

_WORKER_CANDLES: List[Candle] = []
_WORKER_INTERVAL_VALUE: str = "1h"
_WORKER_TARGET: OptimizationTarget = OptimizationTarget.RETURN_DRAWDOWN_RATIO
_WORKER_CUSTOM_SCORE_EXPR: Optional[str] = None


@dataclass
class _CandleRuntime:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class _StrategyRuntime:
    side: GridSide
    lower: float
    upper: float
    grids: int
    leverage: float
    margin: float
    stop_loss: float
    use_base_position: bool
    reopen_after_stop: bool
    fee_rate: float
    slippage: float
    maintenance_margin_rate: float


def _init_worker(
    candles_payload: List[Dict[str, Any]],
    interval_value: str,
    target_value: str,
    custom_expr: Optional[str],
) -> None:
    global _WORKER_CANDLES, _WORKER_INTERVAL_VALUE, _WORKER_TARGET, _WORKER_CUSTOM_SCORE_EXPR

    _WORKER_CANDLES = [
        _CandleRuntime(
            timestamp=datetime.fromisoformat(row["timestamp"]),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row.get("volume", 0.0)),
        )
        for row in candles_payload
    ]
    _WORKER_INTERVAL_VALUE = interval_value
    _WORKER_TARGET = OptimizationTarget(target_value)
    _WORKER_CUSTOM_SCORE_EXPR = custom_expr


def _strategy_from_payload(strategy_dict: Dict[str, Any]) -> _StrategyRuntime:
    side_raw = strategy_dict["side"]
    side = side_raw if isinstance(side_raw, GridSide) else GridSide(str(side_raw))
    return _StrategyRuntime(
        side=side,
        lower=float(strategy_dict["lower"]),
        upper=float(strategy_dict["upper"]),
        grids=int(strategy_dict["grids"]),
        leverage=float(strategy_dict["leverage"]),
        margin=float(strategy_dict["margin"]),
        stop_loss=float(strategy_dict["stop_loss"]),
        use_base_position=bool(strategy_dict.get("use_base_position", False)),
        reopen_after_stop=bool(strategy_dict.get("reopen_after_stop", True)),
        fee_rate=float(strategy_dict.get("fee_rate", 0.0)),
        slippage=float(strategy_dict.get("slippage", 0.0)),
        maintenance_margin_rate=float(strategy_dict.get("maintenance_margin_rate", 0.005)),
    )


def _run_single_combination(task: Dict[str, Any]) -> Dict[str, Any]:
    row_id = int(task["row_id"])
    strategy_dict = task["strategy"]

    try:
        strategy = _strategy_from_payload(strategy_dict)
        result = run_backtest_for_optimization(_WORKER_CANDLES, strategy)

        sharpe = compute_sharpe_ratio_from_values(result.equity_values, _WORKER_INTERVAL_VALUE)
        total_return = float(result.summary["total_return_usdt"])
        max_drawdown = float(result.summary["max_drawdown_pct"])
        win_rate = float(result.summary["win_rate"])
        total_closed_trades = float(result.summary["total_closed_trades"])
        return_drawdown_ratio = compute_return_drawdown_ratio(total_return, max_drawdown)

        metrics = {
            "total_return_usdt": total_return,
            "max_drawdown_pct": max_drawdown,
            "sharpe_ratio": sharpe,
            "win_rate": win_rate,
            "return_drawdown_ratio": return_drawdown_ratio,
            "total_closed_trades": total_closed_trades,
        }

        score = compute_score(_WORKER_TARGET, _WORKER_CUSTOM_SCORE_EXPR, metrics)

        return {
            "row_id": row_id,
            "ok": True,
            "summary": {
                "total_return_usdt": total_return,
                "max_drawdown_pct": max_drawdown,
                "win_rate": win_rate,
                "total_closed_trades": total_closed_trades,
            },
            "sharpe_ratio": sharpe,
            "return_drawdown_ratio": return_drawdown_ratio,
            "score": score,
        }
    except Exception as exc:  # pragma: no cover - worker-level safeguard
        return {
            "row_id": row_id,
            "ok": False,
            "error": str(exc),
            "summary": None,
            "sharpe_ratio": 0.0,
            "return_drawdown_ratio": 0.0,
            "score": float("-inf"),
        }


def _resolve_worker_count(max_workers: int) -> int:
    cpu_count = os.cpu_count() or 1
    if max_workers <= 0:
        return cpu_count
    return max(1, min(max_workers, cpu_count))


def _iter_batches(tasks: List[Dict[str, Any]], batch_size: int) -> Iterable[List[Dict[str, Any]]]:
    for start in range(0, len(tasks), batch_size):
        yield tasks[start : start + batch_size]


def _chunksize(batch_len: int, worker_count: int) -> int:
    # Small chunks reduce tail latency, larger chunks reduce IPC overhead.
    return max(1, min(256, batch_len // max(worker_count * 8, 1)))


def _multiprocessing_context():
    try:
        return get_context("spawn")
    except ValueError:
        return get_context()


def run_combinations_parallel(
    candles: List[Candle],
    tasks: List[Dict[str, Any]],
    interval_value: str,
    target: OptimizationTarget,
    custom_score_expr: Optional[str],
    max_workers: int,
    batch_size: int = 300,
    chunk_size: int = 64,
    progress_hook: Optional[Callable[[int, int], None]] = None,
) -> List[Dict[str, Any]]:
    if not tasks:
        return []

    candles_payload = [
        {
            "timestamp": c.timestamp.isoformat(),
            "open": c.open,
            "high": c.high,
            "low": c.low,
            "close": c.close,
            "volume": c.volume,
        }
        for c in candles
    ]

    worker_count = _resolve_worker_count(max_workers)
    effective_batch_size = max(1, int(batch_size))
    forced_chunksize = max(1, int(chunk_size))
    results: List[Dict[str, Any]] = []
    total = len(tasks)
    done = 0

    def emit_progress(item: Dict[str, Any]) -> None:
        nonlocal done
        results.append(item)
        done += 1
        if progress_hook:
            progress_hook(done, total)

    try:
        ctx = _multiprocessing_context()
        with ctx.Pool(
            processes=worker_count,
            initializer=_init_worker,
            initargs=(candles_payload, interval_value, target.value, custom_score_expr),
        ) as pool:
            for batch in _iter_batches(tasks, effective_batch_size):
                step_chunksize = forced_chunksize if chunk_size > 0 else _chunksize(len(batch), worker_count)
                for item in pool.imap_unordered(_run_single_combination, batch, chunksize=step_chunksize):
                    emit_progress(item)
    except (PermissionError, OSError, RuntimeError):
        # Some restricted environments disallow process semaphore checks.
        _init_worker(candles_payload, interval_value, target.value, custom_score_expr)
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            for batch in _iter_batches(tasks, effective_batch_size):
                for item in executor.map(_run_single_combination, batch):
                    emit_progress(item)

    return results
