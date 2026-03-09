from __future__ import annotations

from fastapi import APIRouter

from app.api.backtest_router import router as backtest_router
from app.api.live_router import router as live_router
from app.api.ops_router import router as ops_router
from app.api.optimization_router import router as optimization_router

router = APIRouter(prefix="/api/v1")
router.include_router(ops_router)
router.include_router(backtest_router)
router.include_router(live_router)
router.include_router(optimization_router)
