from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api import routes as endpoints

router = APIRouter(tags=["backtest"])
router.get("/backtest/defaults")(endpoints.get_defaults)
router.post("/backtest/run")(endpoints.run_backtest_api)
router.post("/backtest/start")(endpoints.start_backtest_api)
router.post("/backtest/anchor-price")(endpoints.backtest_anchor_price_api)
router.get("/backtest/{job_id}")(endpoints.backtest_status_api)
router.get("/jobs/{job_id}/stream", response_class=StreamingResponse)(endpoints.job_stream_api)
router.post("/backtest/{job_id}/cancel")(endpoints.backtest_cancel_api)
router.get("/market/params")(endpoints.market_params_api)
