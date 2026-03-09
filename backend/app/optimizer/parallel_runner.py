from __future__ import annotations

import os
import sys
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from multiprocessing import get_context
from multiprocessing.pool import Pool
from types import SimpleNamespace
from typing import Any, Callable, Dict, Iterable, List, Optional

from app.core.optimization_schemas import OptimizationTarget
from app.core.schemas import Candle, GridSide, StrategyConfig
from app.optimizer.scoring import compute_return_drawdown_ratio, compute_score, compute_sharpe_ratio_from_values
from app.services.backtest_engine import run_backtest_for_optimization

_WORKER_CANDLES: List[Candle] = []
_WORKER_FUNDING_RATES: List[tuple[datetime, float]] = []
_WORKER_INTERVAL_VALUE: str = "1h"
_WORKER_TARGET: OptimizationTarget = OptimizationTarget.RETURN_DRAWDOWN_RATIO
_WORKER_CUSTOM_SCORE_EXPR: Optional[str] = None
_ALLOW_PROCESS_FALLBACK_TO_THREAD = (
    str(os.getenv("OPTIMIZER_PROCESS_FALLBACK_TO_THREAD", "1")).strip().lower() not in {"0", "false", "no", "off"}
)
_LOGGER = logging.getLogger(__name__)
_STRATEGY_DEFAULTS: Dict[str, Any] = {
    name: field.default
    for name, field in StrategyConfig.model_fields.items()
    if not field.is_required()
}


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
    maker_fee_rate: Optional[float]
    taker_fee_rate: Optional[float]
    slippage: float
    maintenance_margin_rate: float
    funding_rate_per_8h: float
    funding_interval_hours: int
    use_mark_price_for_liquidation: bool
    price_tick_size: float
    quantity_step_size: float
    min_notional: float


def _init_worker(
    candles_payload: List[Dict[str, Any]],
    funding_payload: Optional[List[Dict[str, Any]]],
    interval_value: str,
    target_value: str,
    custom_expr: Optional[str],
) -> None:
    global _WORKER_CANDLES, _WORKER_FUNDING_RATES, _WORKER_INTERVAL_VALUE, _WORKER_TARGET, _WORKER_CUSTOM_SCORE_EXPR

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
    _WORKER_FUNDING_RATES = [
        (datetime.fromisoformat(row["timestamp"]), float(row["rate"]))
        for row in (funding_payload or [])
    ]
    _WORKER_INTERVAL_VALUE = interval_value
    _WORKER_TARGET = OptimizationTarget(target_value)
    _WORKER_CUSTOM_SCORE_EXPR = custom_expr


def _strategy_from_payload(strategy_dict: Dict[str, Any]) -> _StrategyRuntime:
    side_raw = strategy_dict["side"]
    side = side_raw if isinstance(side_raw, GridSide) else GridSide(str(side_raw))
    normalized: Dict[str, Any] = dict(_STRATEGY_DEFAULTS)
    normalized.update(strategy_dict)
    maker_fee_raw = normalized.get("maker_fee_rate")
    taker_fee_raw = normalized.get("taker_fee_rate")
    normalized["side"] = side
    normalized["maker_fee_rate"] = None if maker_fee_raw is None else float(maker_fee_raw)
    normalized["taker_fee_rate"] = None if taker_fee_raw is None else float(taker_fee_raw)
    normalized["fee_rate"] = float(normalized.get("fee_rate", 0.0))
    normalized["slippage"] = float(normalized.get("slippage", 0.0))
    normalized["maintenance_margin_rate"] = float(normalized.get("maintenance_margin_rate", 0.005))
    normalized["funding_rate_per_8h"] = float(normalized.get("funding_rate_per_8h", 0.0))
    normalized["funding_interval_hours"] = int(normalized.get("funding_interval_hours", 8))
    normalized["use_mark_price_for_liquidation"] = bool(normalized.get("use_mark_price_for_liquidation", False))
    normalized["price_tick_size"] = float(normalized.get("price_tick_size", 0.0))
    normalized["quantity_step_size"] = float(normalized.get("quantity_step_size", 0.0))
    normalized["min_notional"] = float(normalized.get("min_notional", 0.0))
    normalized["use_base_position"] = bool(normalized.get("use_base_position", False))
    normalized["reopen_after_stop"] = bool(normalized.get("reopen_after_stop", True))

    return _StrategyRuntime(
        side=side,
        lower=float(normalized["lower"]),
        upper=float(normalized["upper"]),
        grids=int(normalized["grids"]),
        leverage=float(normalized["leverage"]),
        margin=float(normalized["margin"]),
        stop_loss=float(normalized["stop_loss"]),
        use_base_position=bool(normalized["use_base_position"]),
        reopen_after_stop=bool(normalized["reopen_after_stop"]),
        fee_rate=float(normalized["fee_rate"]),
        maker_fee_rate=normalized["maker_fee_rate"],
        taker_fee_rate=normalized["taker_fee_rate"],
        slippage=float(normalized["slippage"]),
        maintenance_margin_rate=float(normalized["maintenance_margin_rate"]),
        funding_rate_per_8h=float(normalized["funding_rate_per_8h"]),
        funding_interval_hours=int(normalized["funding_interval_hours"]),
        use_mark_price_for_liquidation=bool(normalized["use_mark_price_for_liquidation"]),
        price_tick_size=float(normalized["price_tick_size"]),
        quantity_step_size=float(normalized["quantity_step_size"]),
        min_notional=float(normalized["min_notional"]),
    )


def _run_single_combination(task: Dict[str, Any]) -> Dict[str, Any]:
    row_id = int(task["row_id"])
    strategy_dict = task["strategy"]

    try:
        strategy = _strategy_from_payload(strategy_dict)
        try:
            result = run_backtest_for_optimization(_WORKER_CANDLES, strategy, funding_rates=_WORKER_FUNDING_RATES)
        except AttributeError:
            # Defensive fallback for schema drift between optimization payload
            # and worker runtime strategy shape.
            strategy_model = StrategyConfig.model_validate(strategy_dict)
            payload = strategy_model.model_dump()
            side_raw = payload["side"]
            payload["side"] = side_raw if isinstance(side_raw, GridSide) else GridSide(str(side_raw))
            strategy_ns = SimpleNamespace(**payload)
            result = run_backtest_for_optimization(_WORKER_CANDLES, strategy_ns, funding_rates=_WORKER_FUNDING_RATES)

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
    preferred = str(os.getenv("OPTIMIZER_MP_START_METHOD", "")).strip().lower()
    candidates: list[str] = []
    if preferred:
        candidates.append(preferred)
    if os.name == "nt":
        candidates.append("spawn")
    else:
        if sys.platform == "darwin":
            # On macOS, spawn/forkserver are generally more stable than fork for
            # long-running scientific workloads and threaded web runtimes.
            candidates.extend(["spawn", "forkserver", "fork"])
        else:
            # On Linux, fork/forkserver usually start faster than spawn.
            candidates.extend(["fork", "forkserver", "spawn"])

    tried: set[str] = set()
    for method in candidates:
        if not method or method in tried:
            continue
        tried.add(method)
        try:
            return get_context(method)
        except ValueError:
            continue
    return get_context()


def _serialize_candles(candles: List[Candle]) -> List[Dict[str, Any]]:
    return [
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


def _serialize_funding_rates(funding_rates: List[tuple[datetime, float]]) -> List[Dict[str, Any]]:
    return [
        {
            "timestamp": ts.isoformat(),
            "rate": float(rate),
        }
        for ts, rate in funding_rates
    ]


class CombinationEvaluator:
    def __init__(
        self,
        *,
        candles: List[Candle],
        funding_rates: Optional[List[tuple[datetime, float]]],
        interval_value: str,
        target: OptimizationTarget,
        custom_score_expr: Optional[str],
        max_workers: int,
    ) -> None:
        self._candles_payload = _serialize_candles(candles)
        self._funding_payload = _serialize_funding_rates(list(funding_rates or []))
        self._interval_value = interval_value
        self._target = target
        self._custom_score_expr = custom_score_expr
        self._worker_count = _resolve_worker_count(max_workers)
        self._max_tasks_per_child = max(10, int(os.getenv("OPTIMIZER_WORKER_MAX_TASKS", "500")))
        self._pool: Optional[Pool] = None
        self._executor: Optional[ThreadPoolExecutor] = None
        self._uses_threads = False
        self._engine = "process"
        self._last_pool_error: Optional[str] = None

    def __enter__(self) -> "CombinationEvaluator":
        try:
            ctx = _multiprocessing_context()
            self._pool = ctx.Pool(
                processes=self._worker_count,
                initializer=_init_worker,
                initargs=(
                    self._candles_payload,
                    self._funding_payload,
                    self._interval_value,
                    self._target.value,
                    self._custom_score_expr,
                ),
                maxtasksperchild=self._max_tasks_per_child,
            )
        except (PermissionError, OSError, RuntimeError):
            # Some restricted environments disallow process semaphore checks.
            _init_worker(
                self._candles_payload,
                self._funding_payload,
                self._interval_value,
                self._target.value,
                self._custom_score_expr,
            )
            self._executor = ThreadPoolExecutor(max_workers=self._worker_count)
            self._uses_threads = True
            self._engine = "thread"
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._pool is not None:
            try:
                self._pool.close()
            except Exception:
                try:
                    self._pool.terminate()
                except Exception:
                    pass
            try:
                self._pool.join()
            except Exception:
                pass
            self._pool = None
        if self._executor is not None:
            self._executor.shutdown(wait=True)
            self._executor = None

    def _pool_worker_exit_diagnostics(self) -> str:
        if self._pool is None:
            return "pool=none"
        workers = getattr(self._pool, "_pool", None)
        if not isinstance(workers, list):
            return "pool=unknown"
        details: List[str] = []
        for proc in workers:
            pid = getattr(proc, "pid", None)
            exitcode = getattr(proc, "exitcode", None)
            try:
                alive = bool(proc.is_alive())
            except Exception:
                alive = False
            details.append(f"pid={pid},exit={exitcode},alive={int(alive)}")
        return "; ".join(details) if details else "pool=empty"

    def _enable_thread_fallback(self) -> None:
        if self._pool is not None:
            try:
                self._pool.terminate()
            except Exception:
                pass
            try:
                self._pool.join()
            except Exception:
                pass
            self._pool = None
        _init_worker(
            self._candles_payload,
            self._funding_payload,
            self._interval_value,
            self._target.value,
            self._custom_score_expr,
        )
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=self._worker_count)
        self._uses_threads = True
        self._engine = "thread-fallback"

    def run(
        self,
        tasks: List[Dict[str, Any]],
        *,
        batch_size: int = 300,
        chunk_size: int = 64,
        progress_hook: Optional[Callable[[int, int], None]] = None,
    ) -> List[Dict[str, Any]]:
        if not tasks:
            return []

        effective_batch_size = max(1, int(batch_size))
        forced_chunksize = max(1, int(chunk_size))
        results: List[Dict[str, Any]] = []
        total = len(tasks)
        done = 0
        seen_row_ids: set[int] = set()

        def emit_progress(item: Dict[str, Any]) -> None:
            nonlocal done
            row_id = int(item.get("row_id", -1))
            if row_id > 0:
                if row_id in seen_row_ids:
                    return
                seen_row_ids.add(row_id)
            results.append(item)
            done += 1
            if progress_hook:
                progress_hook(done, total)

        if self._uses_threads:
            if self._executor is None:
                raise RuntimeError("thread evaluator is not initialized")
            for batch in _iter_batches(tasks, effective_batch_size):
                for item in self._executor.map(_run_single_combination, batch):
                    emit_progress(item)
            return results

        if self._pool is None:
            raise RuntimeError("process evaluator is not initialized")

        try:
            for batch in _iter_batches(tasks, effective_batch_size):
                step_chunksize = forced_chunksize if chunk_size > 0 else _chunksize(len(batch), self._worker_count)
                for item in self._pool.imap_unordered(_run_single_combination, batch, chunksize=step_chunksize):
                    emit_progress(item)
        except Exception as exc:
            diagnostics = self._pool_worker_exit_diagnostics()
            self._last_pool_error = f"{type(exc).__name__}: {exc}; workers=[{diagnostics}]"
            _LOGGER.warning("process evaluator failed, switching to thread fallback: %s", self._last_pool_error)
            if not _ALLOW_PROCESS_FALLBACK_TO_THREAD:
                raise RuntimeError(f"process evaluator failed: {self._last_pool_error}") from exc

            self._enable_thread_fallback()
            if self._executor is None:
                raise RuntimeError(f"thread fallback unavailable after pool failure: {self._last_pool_error}") from exc

            pending = [task for task in tasks if int(task.get("row_id", -1)) not in seen_row_ids]
            for batch in _iter_batches(pending, effective_batch_size):
                for item in self._executor.map(_run_single_combination, batch):
                    emit_progress(item)
        return results

    @property
    def engine(self) -> str:
        return self._engine

    @property
    def last_pool_error(self) -> Optional[str]:
        return self._last_pool_error


def run_combinations_parallel(
    candles: List[Candle],
    tasks: List[Dict[str, Any]],
    funding_rates: Optional[List[tuple[datetime, float]]],
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

    with CombinationEvaluator(
        candles=candles,
        funding_rates=funding_rates,
        interval_value=interval_value,
        target=target,
        custom_score_expr=custom_score_expr,
        max_workers=max_workers,
    ) as evaluator:
        return evaluator.run(tasks, batch_size=batch_size, chunk_size=chunk_size, progress_hook=progress_hook)
