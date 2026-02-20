from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, Iterator, List, Optional, Protocol

from app.core.optimization_schemas import OptimizationResultRow


class JobLike(Protocol):
    meta: Any
    target: Any
    request_payload: Optional[Dict[str, Any]]


def csv_scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _emit_row(values: List[object]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(values)
    return buffer.getvalue()


def iter_rows_csv(rows: List[OptimizationResultRow], *, record: Optional[JobLike] = None) -> Iterator[str]:
    if record is not None:
        yield _emit_row(["section", "key", "value"])
        yield _emit_row(["job_meta", "job_id", record.meta.job_id])
        yield _emit_row(["job_meta", "status", record.meta.status.value])
        yield _emit_row(["job_meta", "created_at", record.meta.created_at.isoformat()])
        yield _emit_row(["job_meta", "started_at", record.meta.started_at.isoformat() if record.meta.started_at else ""])
        yield _emit_row(["job_meta", "finished_at", record.meta.finished_at.isoformat() if record.meta.finished_at else ""])
        yield _emit_row(["job_meta", "total_combinations", record.meta.total_combinations])
        yield _emit_row(["job_meta", "trials_completed", record.meta.trials_completed])
        yield _emit_row(["job_meta", "trials_pruned", record.meta.trials_pruned])
        yield _emit_row(["job_meta", "pruning_ratio", record.meta.pruning_ratio])
        yield _emit_row(["job_meta", "target", record.target.value])
        yield _emit_row(["job_meta", "message", csv_scalar(record.meta.message)])

        request_payload = record.request_payload if isinstance(record.request_payload, dict) else None
        if request_payload is not None:
            yield _emit_row([])
            yield _emit_row(["section", "key", "value"])
            yield _emit_row(["request", "json", json.dumps(request_payload, ensure_ascii=False, separators=(",", ":"))])
            base_strategy = request_payload.get("base_strategy", {})
            optimization = request_payload.get("optimization", {})
            data = request_payload.get("data", {})

            for key, value in sorted(base_strategy.items()):
                yield _emit_row(["base_strategy", key, csv_scalar(value)])
            for key, value in sorted(data.items()):
                if key == "csv_content":
                    continue
                yield _emit_row(["data", key, csv_scalar(value)])
            for key, value in sorted(optimization.items()):
                yield _emit_row(["optimization", key, csv_scalar(value)])

        yield _emit_row([])

    yield _emit_row(
        [
            "row_id",
            "leverage",
            "grids",
            "use_base_position",
            "base_grid_count",
            "initial_position_size",
            "anchor_price",
            "lower_price",
            "upper_price",
            "stop_price",
            "band_width_pct",
            "range_lower",
            "range_upper",
            "stop_loss",
            "stop_loss_ratio_pct",
            "total_return_usdt",
            "max_drawdown_pct",
            "sharpe_ratio",
            "win_rate",
            "return_drawdown_ratio",
            "score",
            "validation_total_return_usdt",
            "validation_max_drawdown_pct",
            "validation_sharpe_ratio",
            "validation_win_rate",
            "validation_return_drawdown_ratio",
            "validation_score",
            "validation_total_closed_trades",
            "robust_score",
            "overfit_penalty",
            "passes_constraints",
            "constraint_violations",
            "total_closed_trades",
        ]
    )

    for row in rows:
        yield _emit_row(
            [
                row.row_id,
                row.leverage,
                row.grids,
                row.use_base_position,
                row.base_grid_count,
                row.initial_position_size,
                row.anchor_price,
                row.lower_price,
                row.upper_price,
                row.stop_price,
                row.band_width_pct,
                row.range_lower,
                row.range_upper,
                row.stop_loss,
                row.stop_loss_ratio_pct,
                row.total_return_usdt,
                row.max_drawdown_pct,
                row.sharpe_ratio,
                row.win_rate,
                row.return_drawdown_ratio,
                row.score,
                row.validation_total_return_usdt,
                row.validation_max_drawdown_pct,
                row.validation_sharpe_ratio,
                row.validation_win_rate,
                row.validation_return_drawdown_ratio,
                row.validation_score,
                row.validation_total_closed_trades,
                row.robust_score,
                row.overfit_penalty,
                row.passes_constraints,
                ";".join(row.constraint_violations),
                row.total_closed_trades,
            ]
        )


def export_rows_csv(rows: List[OptimizationResultRow], *, record: Optional[JobLike] = None) -> str:
    return "".join(iter_rows_csv(rows, record=record))
