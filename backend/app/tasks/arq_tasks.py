from __future__ import annotations

import asyncio
from typing import Any

from app.optimizer.optimizer import run_optimization_job_from_arq
from app.services.backtest_jobs import run_backtest_job_from_arq


async def arq_run_backtest_job(ctx: dict[str, Any], job_id: str, payload: dict[str, Any]) -> dict[str, str]:
    await asyncio.to_thread(run_backtest_job_from_arq, job_id=job_id, payload_data=payload)
    return {"job_id": job_id, "status": "done"}


async def arq_run_optimization_job(ctx: dict[str, Any], job_id: str, payload: dict[str, Any]) -> dict[str, str]:
    await asyncio.to_thread(run_optimization_job_from_arq, job_id=job_id, payload_data=payload)
    return {"job_id": job_id, "status": "done"}
