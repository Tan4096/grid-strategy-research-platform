from __future__ import annotations

from app.tasks.arq_queue import arq_job_timeout_seconds, arq_max_jobs, arq_queue_name, redis_settings_from_env
from app.tasks.arq_tasks import arq_run_backtest_job, arq_run_optimization_job


class WorkerSettings:
    functions = [arq_run_backtest_job, arq_run_optimization_job]
    redis_settings = redis_settings_from_env()
    queue_name = arq_queue_name()
    max_jobs = arq_max_jobs()
    job_timeout = arq_job_timeout_seconds()
