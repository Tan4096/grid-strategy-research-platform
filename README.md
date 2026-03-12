# Grid Strategy Research Platform

中文：一个面向永续合约网格策略研究的 Web 平台，覆盖回测、参数优化、结构诊断、结果导出与实盘监测。  
English: A web platform for perpetual futures grid strategy research, covering backtesting, optimization, diagnostics, exports, and live monitoring.

> This project is for research and validation workflows. It is **not** investment advice, trade execution software, or a guarantee of profitability.

![Project overview](docs/assets/github-overview.svg)

## Why This Project / 项目定位

它适合这样的场景：

- 你想快速验证某个网格思路，而不是先搭一套复杂脚本体系
- 你需要把“参数假设 -> 回测结果 -> 优化复核 -> 风险检查”放在同一工作流里
- 你希望本地或内网自部署，自己掌握数据、密钥和运行方式

核心目标不是“预测行情”，而是让策略研究过程更可重复、更可解释、更可复核。

## Core Capabilities / 核心能力

### Backtest / 回测
- Binance / Bybit / OKX / CSV 数据源
- 支持 Long / Short 网格，包含手续费、滑点、资金费率、止损、强平、可选底仓
- 输出权益曲线、回撤、杠杆占用、强平价、事件时间线与成交明细

### Optimization / 参数优化
- `grid`、`bayesian`、`random_pruned` 三种搜索模式
- 支持杠杆、网格数、区间宽度、止损比率、底仓行为等参数维度
- 提供异步任务、历史记录、重试/恢复、热力图、导出与一键回填回测

### Diagnostics / 结构诊断
- 回测与优化结果的结构化分析
- 面向收益-风险平衡的策略评分与复核视图
- 便于快速识别“看起来收益高但稳定性不足”的参数组合

### Live Monitoring / 实盘监测
- 当前重点：OKX 机器人快照与监测流程
- 覆盖仓位、挂单、成交、资金费、推断网格、诊断与趋势视图
- 浏览器仅在你明确选择时才持久化凭据

## Screenshots / 截图预览

当前公开仓库仅提供截图预览，**不提供公网在线 Demo**。  
All screenshots below use masked demo data and checked-in assets under `docs/assets/readme-*.png`.

### 1) 回测工作台（参数输入 + 结果同屏）

![Backtest overview](docs/assets/readme-backtest-overview.png)

- 左侧填写市场、策略与风控参数，右侧立即查看收益与风险指标
- 适合先做“区间与仓位假设”的第一轮筛选

### 2) 参数优化结果（排名 + 最优组合摘要）

![Optimization results](docs/assets/readme-optimization-results.png)

- 一屏查看最优参数、核心指标、任务状态和候选组合
- 适合从“能跑”快速进入“可比较、可复核”

### 3) 参数热力图（区域分布诊断）

![Optimization heatmap](docs/assets/readme-optimization-heatmap.png)

- 用杠杆 × 网格数热力图观察参数分布
- 快速识别“局部峰值”与“稳定区间”，避免只看单点最优

### 4) 实盘监测面板（总览 + 风险 + 趋势）

![Live monitoring overview](docs/assets/readme-live-monitoring.png)

- 统一展示监测总览、风险配置、收益趋势和账单拆解
- 图中为演示数据，不包含真实账户信息

本地重新生成 README 截图：

```bash
cd frontend
npm run capture:readme-screenshots
```

## Quick Start / 快速开始

### Requirements / 环境要求

- Python `3.11`（建议，与 CI / Docker 更一致）
- Node.js `20`（建议，前端构建与测试一致）
- Redis：本地私有研究可选；启用 Arq 任务持久化时需要
- Chromium：仅在运行 Playwright e2e 或重生成 README 截图时需要

### Option A — one command / 一键启动

```bash
make dev
```

`make dev` 会在缺少依赖时自动准备 `backend/.venv` 和 `frontend/node_modules`，随后启动前后端。

默认访问地址：

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

### Option B — manual setup / 手动启动

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
make doctor
cd frontend
npm ci
npm run dev
```

请先切到 Node `20.x`，再执行一次干净的 `npm ci`。

## Typical Workflow / 常见研究流程

1. 在参数面板填写市场、策略与风险参数。
2. 运行回测并检查指标、曲线、成交明细与事件时间线。
3. 启动优化任务，查看排名、热力图和稳健性相关视图。
4. 将候选参数一键回填到回测面板复核。
5. 如需实盘观测，在自部署环境启用监测并接入凭据。

## Architecture / 架构概览

```text
frontend (React + Vite + TypeScript)
  ├─ parameter workspace
  ├─ backtest workspace
  ├─ optimization workspace
  └─ live monitoring workspace

backend (FastAPI)
  ├─ backtest services
  ├─ optimization services and job store
  ├─ live snapshot services and exchange adapters
  ├─ auth / audit / rate limit / concurrency guards
  └─ task backends (in-memory / Arq)
```

开发与部署文档：

- Backend: `backend/README.md`
- Frontend: `frontend/README.md`
- Deployment: `deploy/README.md`
- Config reference: `deploy/CONFIG_REFERENCE.md`
- Release checklist: `release/OPEN_SOURCE_RELEASE_CHECKLIST.md`

## Compatibility Policy / 兼容性策略

- HTTP API 路径、请求体、响应体以及鉴权/限流语义默认保持向后兼容；若有破坏性变更会显式说明。
- 任何后端 API 变更，前端传输契约应在同一 PR 内基于 OpenAPI 重新生成。
- UI 内部状态模型可演进，但用户可见工作流退化应由单测或 e2e 覆盖。

## Deployment Defaults / 部署默认分组

<!-- BEGIN GENERATED:CONFIG_SUMMARY -->
- Generated from `deploy/env.catalog.json`; rerun `make config-docs` after changing defaults.
- **Project**: Ports, logging, and CORS defaults that shape local and deployed runtime topology. Example keys: `COMPOSE_PROJECT_NAME`, `BACKEND_PORT`, `BACKEND_WORKERS`, `FRONTEND_PORT`.
- **Auth**: Authentication and JWT defaults for shared or public deployments. Example keys: `APP_AUTH_ENABLED`, `APP_PUBLIC_MODE`, `APP_AUTH_API_KEYS`, `APP_AUTH_BEARER_TOKENS`.
- **Task Backend**: Queue, Redis, and task backend settings for background job execution and state persistence. Example keys: `APP_TASK_BACKEND`, `APP_BACKTEST_TASK_BACKEND`, `APP_OPTIMIZATION_TASK_BACKEND`, `APP_ARQ_REDIS_DSN`.
- **Runtime Guards**: Rate-limit and concurrency ceilings that protect shared environments. Example keys: `APP_RATE_LIMIT_ENABLED`, `APP_RATE_LIMIT_WRITE_RPM`, `APP_RATE_LIMIT_IP_WRITE_RPM`, `APP_CONCURRENCY_LIMIT_ENABLED`.
- **Optimization Store**: Persistence, recovery, and retention limits for optimization/backtest job records. Example keys: `OPTIMIZATION_SELECTED_CLEAR_MAX`, `OPTIMIZATION_SELECTED_CLEAR_MAX_PUBLIC`, `OPTIMIZATION_RECOVERY_ENABLED`, `OPTIMIZATION_RECOVERY_MAX_JOBS`.
- **Frontend**: Build-time frontend API base and browser-side task recovery controls. Example keys: `VITE_API_BASE`, `VITE_JOB_RESUME_ENABLED`.
- Full generated tables live in `deploy/CONFIG_REFERENCE.md`.
<!-- END GENERATED:CONFIG_SUMMARY -->

## Examples / 最小示例

`examples/` 目录包含可复现的最小请求样例：

- `examples/backtest.request.json`
- `examples/optimization.request.json`
- `examples/sample-ohlcv.csv`

这些示例仅用于本地测试与文档说明，不构成交易建议。

## Tests and Quality Gates / 测试与质量门禁

根目录命令：

```bash
make backend-test
make frontend-lint
make frontend-contract
make frontend-test
make frontend-build
make test
make oss-check
make review-surface
```

直接命令：

```bash
backend/.venv/bin/python -m pytest backend/tests -q
cd frontend && npm run gen:api-types && git diff --exit-code -- src/lib/api.generated.ts
cd frontend && npm run lint && npm run test:unit && npm run build
```

公开发布前建议满足：

- backend tests 通过
- frontend API types 重新生成且无漂移
- frontend lint / unit / build 全绿
- repository hygiene 检查通过
- README 截图在 GitHub 渲染正常
- 无 secrets、本地路径、数据库、构建产物入库

## Deployment Modes / 部署方式

### Local research mode / 本地研究模式
- 启动阻力小，适合快速验证
- 可在私有机器使用更宽松的鉴权策略

### Public deployment mode / 公网部署模式
- 启用认证
- 保持限流与审计日志
- 需要时使用持久化状态与 Redis
- 严格复核 CORS 与密钥管理

部署模板见 `deploy/README.md` 与 `deploy/.env.example`。

## Open Source Notes / 开源说明

- License: `MIT`
- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`

推荐的 GitHub 元信息见 `release/GITHUB_METADATA.md`。

## Risk Notice / 风险声明

- 历史表现不代表未来收益。
- 交易所规则、费率、资金费与强平逻辑需在真实环境再次核验。
- 实盘监测是观测与复核流程，不提供执行保证。
- 严禁提交真实 API key、token、passphrase 或 `.env` 敏感值。
