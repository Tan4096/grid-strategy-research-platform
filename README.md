# Grid Strategy Research Platform

中文：面向永续合约网格策略研究的全功能 Web 工具，覆盖回测、参数优化、结构诊断、结果导出与实盘监测。  
English: A full-featured web app for perpetual futures grid strategy research, covering backtesting, optimization, diagnostics, exports, and live monitoring.

> This project is for research and validation workflows. It is **not** investment advice, trade execution software, or a guarantee of profitability.

![Project overview](docs/assets/github-overview.svg)

## Overview / 项目简介

This repository is designed for self-hosted strategy research:

- **Backtest / 回测**: candle-by-candle perpetual futures grid simulation
- **Optimization / 优化**: grid, bayesian, and random-pruned search modes
- **Diagnostics / 诊断**: structure analysis, scoring, and risk-focused review
- **Live Monitoring / 实盘监测**: optional OKX-focused monitoring and reconciliation views
- **Deployment Templates / 部署模板**: Docker Compose and systemd examples

The project keeps the current public API stable and focuses on practical local or internal research workflows.

## Highlights / 核心能力

### Backtest / 回测
- Binance / Bybit / OKX / CSV data sources
- Long / short grid simulation with fees, slippage, funding, stop-loss, liquidation, and optional base position
- Equity, drawdown, leverage usage, liquidation price, event timeline, and trade table views

### Optimization / 参数优化
- `grid`, `bayesian`, `random_pruned`
- Search dimensions for leverage, grids, band width, stop-loss ratio, and optional base-position behavior
- Async jobs, history, retry/restore flow, heatmap, export, and one-click apply-to-backtest

### Live Monitoring / 实盘监测
- Current focus: OKX robot snapshot / monitoring workflow
- Position, open orders, fills, funding, inferred grid, diagnostics, and trend visualization
- Safer browser behavior: credentials should only persist when the user explicitly opts in

## Screenshots / 界面预览

All screenshots below are generated from masked demo data for public documentation.  
以下截图均基于脱敏演示数据生成，仅用于公开仓库展示。

To regenerate the gallery assets locally:
`cd frontend && npm run capture:readme-screenshots`

| 参数配置 + 回测总览 | 参数优化结果 |
| --- | --- |
| ![Backtest overview](docs/assets/readme-backtest-overview.png) | ![Optimization results](docs/assets/readme-optimization-results.png) |
| 左侧参数区与右侧回测结果同屏展示，适合快速验证区间、风险和收益曲线。 | 结果表格、最佳组合摘要与核心指标同屏，适合筛选可继续验证的参数组。 |

| 热力图分析 | 实盘监测面板 |
| --- | --- |
| ![Optimization heatmap](docs/assets/readme-optimization-heatmap.png) | ![Live monitoring overview](docs/assets/readme-live-monitoring.png) |
| 通过杠杆 × 网格数热力图快速观察稳健评分分布，定位可重点复核的参数区域。 | 用演示数据展示监测总览、风险配置、收益趋势和账单拆解，不包含真实账户信息。 |

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

Useful developer docs:

- Backend: `backend/README.md`
- Frontend: `frontend/README.md`
- Deployment: `deploy/README.md`
- Release checklist: `release/OPEN_SOURCE_RELEASE_CHECKLIST.md`

## Requirements / 环境要求

- Python `3.11` recommended for a setup close to CI and Docker
- Node.js `20` recommended for frontend build / test parity
- Redis is optional for local private research mode and required when you enable Arq-backed task/state persistence
- Chromium is only needed if you run Playwright e2e or regenerate the README screenshots

## Quick Start / 快速开始

### Option A — one command / 一键启动

```bash
make dev
```

`make dev` bootstraps `backend/.venv` and `frontend/node_modules` when missing, then starts both services locally.  
`make dev` 会在缺少依赖时自动准备 `backend/.venv` 和 `frontend/node_modules`，随后启动前后端。

Default URLs:

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
cd frontend
npm ci
npm run dev
```

## Common Workflows / 常见使用流程

1. Fill market / strategy / risk inputs in the parameter panel.
2. Run a backtest and review metrics, curves, trades, and event timeline.
3. Start an optimization job and inspect ranked rows, heatmap, and robustness views.
4. Apply an optimized row back to the backtest panel for confirmation.
5. If needed, enable live monitoring with your own deployment and credentials.

## Examples / 最小示例

Minimal reproducible example files are included under `examples/`:

- `examples/backtest.request.json`
- `examples/optimization.request.json`
- `examples/sample-ohlcv.csv`

These examples are meant for local testing and documentation, not as trading recommendations.

## Tests and Quality Gates / 测试与质量门禁

Root commands:

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

Direct commands:

```bash
backend/.venv/bin/python -m pytest backend/tests -q
cd frontend && npm run gen:api-types && git diff --exit-code -- src/lib/api.generated.ts
cd frontend && npm run lint && npm run test:unit && npm run build
```

Public release target:

- backend tests green
- frontend API types regenerated with no drift
- frontend lint / unit / build green
- repository hygiene check green
- README screenshots render correctly on GitHub
- no secrets, local paths, databases, or build outputs committed

## Deployment Modes / 部署方式

### Local research mode / 本地研究模式
- minimal friction
- suitable for local validation
- can run with relaxed auth settings for a private machine

### Public deployment mode / 公网部署模式
- enable authentication
- keep rate limiting and audit logging on
- use persistent state / Redis where required
- carefully review CORS and secret management

See `deploy/README.md` and `deploy/.env.example` for the deployment templates.

## Open Source Notes / 开源说明

- License: `MIT`
- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`

Suggested GitHub metadata is documented in `release/GITHUB_METADATA.md`.

## Risk Notice / 风险声明

- Historical performance does not imply future returns.
- Exchange rules, fee schedules, funding behavior, and liquidation logic should always be re-verified before any real-money usage.
- Live monitoring is an observational workflow, not an execution guarantee.
- Never commit real API keys, tokens, passphrases, or `.env` values.
