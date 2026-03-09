# Grid Strategy Research Platform v1.0.0

## Release readiness
- Backend tests: passed (`152 passed`)
- Frontend unit tests: passed (`160 passed`)
- Frontend lint / typecheck / build: passed
- Frontend targeted Playwright regression suites: passed (`15 passed`)
- API contract generation: passed (`make frontend-contract`)
- Config docs drift checks: passed (`make docs-drift`)
- OSS hygiene checks: passed (`make oss-check`)
- One-command local startup: `make dev`

## Included modules
- Backtest engine (LONG/SHORT, leverage, base position, liquidation, funding)
- Parameter optimization (grid / bayesian / random_pruned)
- Optimization history, CSV export, and backfill-to-backtest
- Live monitoring workspace and OKX-focused diagnostics
- Public repository docs, community files, and repository hygiene checks

## Notes
- This release package excludes local dependency folders and caches (`frontend/node_modules`, `backend/.venv`, build caches).
- README screenshots are generated from masked demo data for public documentation.

Release date: 2026-03-09
