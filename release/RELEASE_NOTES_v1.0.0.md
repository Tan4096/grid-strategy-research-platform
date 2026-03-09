# Grid Strategy Research Platform v1.0.0

## Release readiness
- Frontend build: passed (`npm run build`)
- Backend test: passed (`49 passed`)
- One-click startup script: `./start-dev.sh`

## Included modules
- Backtest engine (LONG/SHORT, leverage, base position, liquidation, funding)
- Parameter optimization (grid / bayesian / random_pruned)
- Optimization history, CSV export, and backfill-to-backtest
- Comparison workspace (current params vs optimized params)

## Notes
- This release package excludes local dependency folders and caches (`frontend/node_modules`, `backend/.venv`, build caches).

Release time: 2026-02-20 07:19:47 UTC
