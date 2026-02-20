# Crypto永续网格回测工具

一个可本地运行的 Crypto 永续合约网格研究平台，包含：
- 回测引擎（逐 K 线仿真）
- 风险与收益可视化
- 参数优化（Grid Search + 并行）
- 实盘参数回填（优化结果一键应用回测）

## 1. 当前能力概览

### 回测模块
- 支持 `LONG / SHORT` 网格
- 支持杠杆、手续费、滑点、止损、止损后重开
- 支持“开底仓”（交易所节点制初始化逻辑）
- 逐 K 线执行，按 high/low 判断触发
- 强平模拟、保证金风险率、预估强平价格
- 支持实盘约束参数：
  - Maker/Taker 分离手续费
  - 资金费率模拟（按周期累计）
  - 价格最小变动、数量最小步长、最小名义金额
  - 可选按标记价进行强平判定
- 输出完整统计：
  - 总收益、年化（数据跨度足够时）
  - 胜率、最大回撤、最大单次亏损、平均持仓时间等
- 图表：
  - K 线 + 网格区间
  - Equity 曲线
  - 回撤曲线
  - 保证金风险相关曲线
  - 事件时间线（open/close/stop/funding/liquidation）

### 参数优化模块
- Grid Search 扫描维度：
  - 杠杆
  - 网格数
  - 区间宽度（百分比）
  - 止损比例（百分比）
  - 可选：`use_base_position` 作为优化维度
- Anchor 模式：
  - `BACKTEST_START_PRICE`
  - `BACKTEST_AVG_PRICE`
  - `CURRENT_PRICE`
  - `CUSTOM_PRICE`
- 输出具体价格参数：
  - `lower_price / upper_price / stop_price / anchor_price`
- 优化目标：
  - 总收益 / 夏普 / 最小回撤 / 收益回撤比 / 自定义评分函数
- 约束与稳健性：
  - 止损与潜在强平边界的硬约束
  - Walk-forward（训练/验证）
  - 最小交易数、回撤约束、正收益约束
- 结果：
  - 排序表 + 分页 + CSV 导出
  - 表格/卡片双视图 + 核心/诊断列预设
  - 热力图
  - 最优参数收益曲线
  - 一键应用到回测模块
  - 优化历史中心（加载历史 / 重启任务 / 双任务对比）

### 性能与体验
- 优化执行为多进程并行 + 批处理
- 支持大规模组合（`max_combinations` 最高可到 `200000`）
- 计算资源三档模式：
  - `极速`
  - `均衡`
  - `省电`
- 前端自动记住并恢复你上次输入：
  - 回测参数
  - 参数优化配置
  - 注意：CSV 文件内容不会持久化（仅保留配置，不缓存大文件）
- 支持命名策略模板：
  - 保存多个模板
  - 一键应用
  - 导入/导出 JSON
- 优化轮询支持可见性退避（前台高频、后台低频）+ ETA 估算 + 完成通知
- 新手 3 步引导卡片（首次打开可见，可关闭）

## 2. 技术栈

- 后端：FastAPI + Pydantic + NumPy + Pandas
- 前端：React + TypeScript + Vite + Tailwind + ECharts
- 数据源：Binance / Bybit / OKX / 用户 CSV
- 交易对：BTCUSDT / ETHUSDT / SOLUSDT / HYPEUSDT（默认 BTCUSDT）

## 3. 目录结构

```text
btc-grid-backtest/
  backend/
    app/
      api/routes.py
      services/backtest_engine.py
      services/data_loader.py
      optimizer/
      core/
      main.py
    scripts/
      benchmark_optimizer_perf.py
    tests/
    requirements.txt
  frontend/
    src/
      App.tsx
      components/
      lib/api.ts
      types.ts
    package.json
```

## 4. 本地运行

### 4.0 一键启动（推荐）

```bash
cd /Users/simon/Desktop/专业学习/Risc-V-CPU/serv-main/btc-grid-backtest
./start-dev.sh
```

默认会同时启动：
- 后端：`http://localhost:8000`
- 前端：`http://localhost:5173`

可选自定义端口：

```bash
BACKEND_PORT=8001 FRONTEND_PORT=5174 ./start-dev.sh
```

按一次 `Ctrl+C` 会同时停止前后端。

### 4.1 启动后端

```bash
cd /Users/simon/Desktop/专业学习/Risc-V-CPU/serv-main/btc-grid-backtest/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

后端默认地址：`http://localhost:8000`

### 4.2 启动前端

```bash
cd /Users/simon/Desktop/专业学习/Risc-V-CPU/serv-main/btc-grid-backtest/frontend
npm install
npm run dev
```

前端默认地址：`http://localhost:5173`

## 5. 时间与周期规则

- 默认时间基准：北京时间 `UTC+8`
- 支持自定义开始/结束时间，精确到分钟
- 不填结束时间时，默认使用当前分钟（UTC+8）
- 周期支持：`1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d`

## 6. CSV 数据格式

至少包含（大小写不敏感，支持别名）：
- `timestamp` / `time` / `datetime` / `date` / `open_time`
- `open`
- `high`
- `low`
- `close`
- `volume`（可选）

`timestamp` 支持：
- ISO 时间字符串
- Unix 秒
- Unix 毫秒

## 7. API 概览

- `GET /api/v1/health`
- `GET /api/v1/backtest/defaults`
- `POST /api/v1/backtest/run`
- `POST /api/v1/optimization/start`
- `POST /api/v1/optimization/{job_id}/cancel`
- `GET /api/v1/optimization/{job_id}/progress`
- `GET /api/v1/optimization/{job_id}`
- `GET /api/v1/optimization/{job_id}/export`
- `GET /api/v1/optimization-history`

## 8.1 生产安全配置

- 后端 CORS 可通过环境变量控制：
  - `CORS_ALLOW_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`
- 优化任务记录支持 TTL 与上限清理：
  - `OPTIMIZATION_JOB_TTL_SECONDS`（默认 86400）
  - `OPTIMIZATION_MAX_JOB_RECORDS`（默认 200）
- 优化结果快照持久化（SQLite）：
  - `OPTIMIZATION_STORE_PATH`（默认 `backend/data/optimization_jobs.sqlite3`）
  - `OPTIMIZATION_PERSIST_ROWS_LIMIT`（默认 5000）

## 8. 测试与构建

### 后端测试

```bash
cd /Users/simon/Desktop/专业学习/Risc-V-CPU/serv-main/btc-grid-backtest/backend
source .venv/bin/activate
pytest -q
```

### 前端构建

```bash
cd /Users/simon/Desktop/专业学习/Risc-V-CPU/serv-main/btc-grid-backtest/frontend
npm run build
```

## 9. 性能基准脚本

仓库内提供优化模块基准脚本：

```bash
cd /Users/simon/Desktop/专业学习/Risc-V-CPU/serv-main/btc-grid-backtest/backend
PYTHONPATH=. .venv/bin/python scripts/benchmark_optimizer_perf.py
```

输出包含：
- 组合数
- 总耗时
- 成功评估数
