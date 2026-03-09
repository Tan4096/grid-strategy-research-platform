# Deployment Guide / 部署说明

This directory contains production-oriented templates.  
本目录提供偏生产环境的部署模板。

## Modes / 两种模式

### Public deployment (recommended default) / 公网部署（默认推荐）

Use the shipped defaults in `deploy/.env.example` as the safer starting point:

- auth enabled
- rate limiting enabled
- concurrency limits enabled
- Redis/state persistence enabled for Arq mode

```bash
cp deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

### Local private research / 本地私有研究模式

If you only run the project on your own machine, you may relax some settings intentionally, for example:

- `APP_AUTH_ENABLED=0`
- `APP_TASK_BACKEND=inmemory`
- narrower CORS to localhost only

Do this only in a trusted local environment.

## Generated Env Groups

<!-- BEGIN GENERATED:DEPLOY_ENV_GROUPS -->
The defaults below are generated from `deploy/env.catalog.json`.

### Project
Ports, logging, and CORS defaults that shape local and deployed runtime topology.

- `COMPOSE_PROJECT_NAME` default: `grid-strategy-research-platform`
- `BACKEND_PORT` default: `8000`
- `BACKEND_WORKERS` default: `1`
- `FRONTEND_PORT` default: `5173`
- `APP_LOG_LEVEL` default: `INFO`
- `CORS_ALLOW_ORIGINS` default: `http://localhost:5173,http://127.0.0.1:5173`

### Auth
Authentication and JWT defaults for shared or public deployments.

- `APP_AUTH_ENABLED` default: `1`
- `APP_PUBLIC_MODE` default: `1`
- `APP_AUTH_API_KEYS` default: `replace-me-admin-key:admin:deploy-admin` — 格式: key:role:subject，多个用逗号分隔
- `APP_AUTH_BEARER_TOKENS` default: `` — 格式: token:role:subject，多个用逗号分隔（可留空）
- `APP_AUTH_JWT_SECRET` default: `replace-with-a-long-random-secret` — 启用 JWT 时设置以下参数
- `APP_AUTH_JWT_ALGORITHM` default: `HS256`
- `APP_AUTH_JWT_AUDIENCE` default: ``
- `APP_AUTH_JWT_ISSUER` default: ``
- `APP_AUTH_JWT_ROLE_CLAIM` default: `role`
- `APP_AUTH_JWT_SUB_CLAIM` default: `sub`

### Task Backend
Queue, Redis, and task backend settings for background job execution and state persistence.

- `APP_TASK_BACKEND` default: `arq`
- `APP_BACKTEST_TASK_BACKEND` default: ``
- `APP_OPTIMIZATION_TASK_BACKEND` default: ``
- `APP_ARQ_REDIS_DSN` default: `redis://redis:6379/0`
- `APP_ARQ_QUEUE_NAME` default: `grid-strategy-research-platform`
- `APP_ARQ_MAX_JOBS` default: `4`
- `APP_ARQ_JOB_TIMEOUT_SECONDS` default: `21600`
- `APP_STATE_REDIS_ENABLED` default: `1`
- `APP_STATE_REDIS_DSN` default: `redis://redis:6379/0`
- `APP_STATE_REDIS_REQUIRED_IN_ARQ` default: `1` — Arq 模式下是否强制要求状态 Redis 可用（1=严格，0=允许降级到内存）

### Runtime Guards
Rate-limit and concurrency ceilings that protect shared environments.

- `APP_RATE_LIMIT_ENABLED` default: `1`
- `APP_RATE_LIMIT_WRITE_RPM` default: `120`
- `APP_RATE_LIMIT_IP_WRITE_RPM` default: `240`
- `APP_CONCURRENCY_LIMIT_ENABLED` default: `1`
- `APP_CONCURRENCY_LIMIT_PER_SUBJECT` default: `2`
- `APP_CONCURRENCY_LIMIT_PER_IP` default: `4`
- `APP_CONCURRENCY_LIMIT_GLOBAL` default: `64`

### Optimization Store
Persistence, recovery, and retention limits for optimization/backtest job records.

- `OPTIMIZATION_SELECTED_CLEAR_MAX` default: `500`
- `OPTIMIZATION_SELECTED_CLEAR_MAX_PUBLIC` default: `120`
- `OPTIMIZATION_RECOVERY_ENABLED` default: `1`
- `OPTIMIZATION_RECOVERY_MAX_JOBS` default: `2`
- `OPTIMIZATION_RECOVERY_SCAN_LIMIT` default: `20`
- `OPTIMIZATION_JOB_TTL_SECONDS` default: `86400`
- `OPTIMIZATION_MAX_JOB_RECORDS` default: `200`
- `OPTIMIZATION_STORE_PATH` default: `/app/data/optimization_jobs.sqlite3`
- `BACKTEST_STORE_PATH` default: `/app/data/backtest_jobs.sqlite3`
- `OPTIMIZATION_PERSIST_ROWS_LIMIT` default: `5000`

### Frontend
Build-time frontend API base and browser-side task recovery controls.

- `VITE_API_BASE` default: `http://localhost:8000` — Frontend build-time API base URL.
- `VITE_JOB_RESUME_ENABLED` default: `1` — 前端任务恢复开关（1=启用，0=关闭）

Regenerate this section with `make config-docs`.
<!-- END GENERATED:DEPLOY_ENV_GROUPS -->

## Docker Compose

Services:

- `backend`
- `frontend`
- `redis`
- `arq-worker`

Default ports:

- Backend API: `8000`
- Frontend UI: `5173`

## systemd

The files in `deploy/systemd/` are templates only.
Before enabling them, update:

- `User` / `Group`
- `WorkingDirectory`
- environment file path

## Security reminders / 安全提醒

- Never commit `deploy/.env`.
- Replace example API keys, JWT secrets, and DSNs before any public deployment.
- Review `SECURITY.md` and the root `README.md` before exposing the service to the internet.

## Config Catalog

`deploy/env.catalog.json` is the machine-readable source for the checked-in `deploy/.env.example`. After changing defaults or adding env vars, run `make env-example`.

`make config-docs` regenerates both `deploy/.env.example` and `deploy/CONFIG_REFERENCE.md` from the catalog.
