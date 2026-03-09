# Backend Developer Guide

中文：本文件面向后端开发者。公开仓库入口、功能概览和快速开始请先看根目录 `README.md`。  
English: This file is for backend contributors. Start with the root `README.md` for the public project overview.

## Stack

- FastAPI
- Pydantic
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
.venv/bin/python -m pytest tests -q
```

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
