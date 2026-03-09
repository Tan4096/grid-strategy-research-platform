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
