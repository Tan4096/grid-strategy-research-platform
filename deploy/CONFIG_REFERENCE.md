# Config Reference

This file is generated from `deploy/env.catalog.json`. Update the catalog and rerun `make config-docs`.

## Project

| Key | Default | Notes |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `grid-strategy-research-platform` | - |
| `BACKEND_PORT` | `8000` | - |
| `BACKEND_WORKERS` | `1` | - |
| `FRONTEND_PORT` | `5173` | - |
| `APP_LOG_LEVEL` | `INFO` | - |
| `CORS_ALLOW_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | - |

## Auth

| Key | Default | Notes |
| --- | --- | --- |
| `APP_AUTH_ENABLED` | `1` | - |
| `APP_PUBLIC_MODE` | `1` | - |
| `APP_AUTH_API_KEYS` | `replace-me-admin-key:admin:deploy-admin` | 格式: key:role:subject，多个用逗号分隔 |
| `APP_AUTH_BEARER_TOKENS` | `` | 格式: token:role:subject，多个用逗号分隔（可留空） |
| `APP_AUTH_JWT_SECRET` | `replace-with-a-long-random-secret` | 启用 JWT 时设置以下参数 |
| `APP_AUTH_JWT_ALGORITHM` | `HS256` | - |
| `APP_AUTH_JWT_AUDIENCE` | `` | - |
| `APP_AUTH_JWT_ISSUER` | `` | - |
| `APP_AUTH_JWT_ROLE_CLAIM` | `role` | - |
| `APP_AUTH_JWT_SUB_CLAIM` | `sub` | - |

## Task Backend

| Key | Default | Notes |
| --- | --- | --- |
| `APP_TASK_BACKEND` | `arq` | - |
| `APP_BACKTEST_TASK_BACKEND` | `` | - |
| `APP_OPTIMIZATION_TASK_BACKEND` | `` | - |
| `APP_ARQ_REDIS_DSN` | `redis://redis:6379/0` | - |
| `APP_ARQ_QUEUE_NAME` | `grid-strategy-research-platform` | - |
| `APP_ARQ_MAX_JOBS` | `4` | - |
| `APP_ARQ_JOB_TIMEOUT_SECONDS` | `21600` | - |
| `APP_STATE_REDIS_ENABLED` | `1` | - |
| `APP_STATE_REDIS_DSN` | `redis://redis:6379/0` | - |
| `APP_STATE_REDIS_REQUIRED_IN_ARQ` | `1` | Arq 模式下是否强制要求状态 Redis 可用（1=严格，0=允许降级到内存） |

## Runtime Guards

| Key | Default | Notes |
| --- | --- | --- |
| `APP_RATE_LIMIT_ENABLED` | `1` | - |
| `APP_RATE_LIMIT_WRITE_RPM` | `120` | - |
| `APP_RATE_LIMIT_IP_WRITE_RPM` | `240` | - |
| `APP_CONCURRENCY_LIMIT_ENABLED` | `1` | - |
| `APP_CONCURRENCY_LIMIT_PER_SUBJECT` | `2` | - |
| `APP_CONCURRENCY_LIMIT_PER_IP` | `4` | - |
| `APP_CONCURRENCY_LIMIT_GLOBAL` | `64` | - |

## Optimization Store

| Key | Default | Notes |
| --- | --- | --- |
| `OPTIMIZATION_SELECTED_CLEAR_MAX` | `500` | - |
| `OPTIMIZATION_SELECTED_CLEAR_MAX_PUBLIC` | `120` | - |
| `OPTIMIZATION_RECOVERY_ENABLED` | `1` | - |
| `OPTIMIZATION_RECOVERY_MAX_JOBS` | `2` | - |
| `OPTIMIZATION_RECOVERY_SCAN_LIMIT` | `20` | - |
| `OPTIMIZATION_JOB_TTL_SECONDS` | `86400` | - |
| `OPTIMIZATION_MAX_JOB_RECORDS` | `200` | - |
| `OPTIMIZATION_STORE_PATH` | `/app/data/optimization_jobs.sqlite3` | - |
| `BACKTEST_STORE_PATH` | `/app/data/backtest_jobs.sqlite3` | - |
| `OPTIMIZATION_PERSIST_ROWS_LIMIT` | `5000` | - |

## Frontend

| Key | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE` | `http://localhost:8000` | Frontend build-time API base URL. |
| `VITE_JOB_RESUME_ENABLED` | `1` | 前端任务恢复开关（1=启用，0=关闭） |

