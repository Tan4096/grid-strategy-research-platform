# Backend Developer Guide

中文：本文件面向后端开发者。公开仓库入口、功能概览和快速开始请先看根目录 `README.md`。  
English: This file is for backend contributors. Start with the root `README.md` for the public project overview.

## Stack

- FastAPI
- Pydantic
- Pydantic Settings
- NumPy / Pandas
- Optuna
- in-memory tasks or Arq-backed workers

## Local Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Key Areas

- `app/api/`: HTTP routes and API glue
- `app/services/`: backtest, market, live snapshot, and shared service logic
- `app/optimizer/`: optimization jobs, persistence, export, query views
- `app/tasks/`: Arq task backend support
- `tests/`: backend test suite

## Tests

```bash
cd backend
.venv/bin/python -m ruff check app/api app/core app/tasks/arq_queue.py
.venv/bin/python -m mypy
.venv/bin/python -m pytest tests -q
```

## Runtime Env Groups

<!-- BEGIN GENERATED:BACKEND_ENV_GROUPS -->
The backend-relevant env groups below are generated from `deploy/env.catalog.json`.

- **Project**: Ports, logging, and CORS defaults that shape local and deployed runtime topology. Keys: `COMPOSE_PROJECT_NAME`, `BACKEND_PORT`, `BACKEND_WORKERS`, `FRONTEND_PORT`, `APP_LOG_LEVEL`, `CORS_ALLOW_ORIGINS`
- **Auth**: Authentication and JWT defaults for shared or public deployments. Keys: `APP_AUTH_ENABLED`, `APP_PUBLIC_MODE`, `APP_AUTH_API_KEYS`, `APP_AUTH_BEARER_TOKENS`, `APP_AUTH_JWT_SECRET`, `APP_AUTH_JWT_ALGORITHM`, `APP_AUTH_JWT_AUDIENCE`, `APP_AUTH_JWT_ISSUER`, `APP_AUTH_JWT_ROLE_CLAIM`, `APP_AUTH_JWT_SUB_CLAIM`
- **Task Backend**: Queue, Redis, and task backend settings for background job execution and state persistence. Keys: `APP_TASK_BACKEND`, `APP_BACKTEST_TASK_BACKEND`, `APP_OPTIMIZATION_TASK_BACKEND`, `APP_ARQ_REDIS_DSN`, `APP_ARQ_QUEUE_NAME`, `APP_ARQ_MAX_JOBS`, `APP_ARQ_JOB_TIMEOUT_SECONDS`, `APP_STATE_REDIS_ENABLED`, `APP_STATE_REDIS_DSN`, `APP_STATE_REDIS_REQUIRED_IN_ARQ`
- **Runtime Guards**: Rate-limit and concurrency ceilings that protect shared environments. Keys: `APP_RATE_LIMIT_ENABLED`, `APP_RATE_LIMIT_WRITE_RPM`, `APP_RATE_LIMIT_IP_WRITE_RPM`, `APP_CONCURRENCY_LIMIT_ENABLED`, `APP_CONCURRENCY_LIMIT_PER_SUBJECT`, `APP_CONCURRENCY_LIMIT_PER_IP`, `APP_CONCURRENCY_LIMIT_GLOBAL`
- **Optimization Store**: Persistence, recovery, and retention limits for optimization/backtest job records. Keys: `OPTIMIZATION_SELECTED_CLEAR_MAX`, `OPTIMIZATION_SELECTED_CLEAR_MAX_PUBLIC`, `OPTIMIZATION_RECOVERY_ENABLED`, `OPTIMIZATION_RECOVERY_MAX_JOBS`, `OPTIMIZATION_RECOVERY_SCAN_LIMIT`, `OPTIMIZATION_JOB_TTL_SECONDS`, `OPTIMIZATION_MAX_JOB_RECORDS`, `OPTIMIZATION_STORE_PATH`, `BACKTEST_STORE_PATH`, `OPTIMIZATION_PERSIST_ROWS_LIMIT`
- Regenerate this section with `make config-docs`.
<!-- END GENERATED:BACKEND_ENV_GROUPS -->

## Security and Public Deployment

For public or shared deployment, review these env groups before going live:

- `APP_AUTH_*`
- `APP_RATE_LIMIT_*`
- `APP_CONCURRENCY_LIMIT_*`
- `APP_TASK_BACKEND`, `APP_STATE_REDIS_*`, `APP_ARQ_*`
- `CORS_ALLOW_ORIGINS`

The deployment template is intentionally stricter than local development.

## Notes for Contributors

- Preserve current public API contracts unless a breaking change is intentional and documented.
- Add tests when changing service behavior or route semantics.
- Do not commit local SQLite files, `.env`, or operational logs.

## Runtime guardrails

Use `make doctor` at the repo root before local startup. The doctor script requires Python `3.11` and Node `20`, matching CI and Docker expectations.

For deployment/runtime defaults, see `deploy/CONFIG_REFERENCE.md`.
