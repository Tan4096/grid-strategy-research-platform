# Backend - Crypto永续网格回测工具

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## API

- `GET /api/v1/health`
- `GET /api/v1/backtest/defaults`
- `POST /api/v1/backtest/run`
- `POST /api/v1/optimization/start`
- `POST /api/v1/optimization/{job_id}/cancel`
- `GET /api/v1/optimization/{job_id}/progress`
- `GET /api/v1/optimization/{job_id}`
- `GET /api/v1/optimization/{job_id}/export`
- `GET /api/v1/optimization-history`

## Request Example

```json
{
  "strategy": {
    "side": "long",
    "lower": 62000,
    "upper": 70000,
    "grids": 24,
    "leverage": 5,
    "margin": 2000,
    "stop_loss": 59000,
    "use_base_position": false,
    "reopen_after_stop": true,
    "fee_rate": 0.0004,
    "slippage": 0.0002,
    "maintenance_margin_rate": 0.005
  },
  "data": {
    "source": "binance",
    "symbol": "BTCUSDT",
    "interval": "1m",
    "lookback_days": 14,
    "start_time": "2026-02-05T13:00:00+08:00",
    "end_time": "2026-02-19T13:00:00+08:00"
  }
}
```

## Notes

- `start_time` / `end_time` supports minute precision.
- Time baseline is Beijing time (`UTC+8`) by default.
- If `end_time` is omitted, backend uses current minute in `UTC+8`.
- If `start_time` is omitted, backend uses `end_time - lookback_days`.
- Supported intervals: `1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d`.
- Supported data sources: `binance`, `bybit`, `okx`, `csv`.
- Common symbols: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `HYPEUSDT` (default `BTCUSDT`).
- CORS origins can be configured via `CORS_ALLOW_ORIGINS`.
- Optimization snapshots are persisted to SQLite for recovery:
  - `OPTIMIZATION_STORE_PATH` (default `backend/data/optimization_jobs.sqlite3`)
  - `OPTIMIZATION_PERSIST_ROWS_LIMIT` (default `5000`)

## Optimization Request Example

```json
{
  "base_strategy": {
    "side": "short",
    "lower": 65000,
    "upper": 71000,
    "grids": 6,
    "leverage": 10,
    "margin": 1000,
    "stop_loss": 72000,
    "use_base_position": false,
    "reopen_after_stop": false,
    "fee_rate": 0.0004,
    "slippage": 0.0002,
    "maintenance_margin_rate": 0.005
  },
  "data": {
    "source": "binance",
    "symbol": "BTCUSDT",
    "interval": "1h",
    "start_time": "2026-02-05T13:00:00+08:00",
    "end_time": "2026-02-19T13:00:00+08:00"
  },
  "optimization": {
    "leverage": { "enabled": true, "start": 5, "end": 12, "step": 1 },
    "grids": { "enabled": true, "start": 4, "end": 12, "step": 1 },
    "band_width_pct": { "enabled": true, "start": 5, "end": 10, "step": 1 },
    "stop_loss_ratio_pct": { "enabled": true, "start": 0.5, "end": 2, "step": 0.5 },
    "optimize_base_position": true,
    "anchor_mode": "BACKTEST_START_PRICE",
    "target": "return_drawdown_ratio",
    "max_combinations": 500,
    "max_workers": 4,
    "walk_forward_enabled": true,
    "train_ratio": 0.5
  }
}
```

## Tests

```bash
cd backend
pytest -q
```
