from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.api import routes as endpoints

router = APIRouter(tags=["ops"])
router.get("/health")(endpoints.health)
router.get("/health/ready")(endpoints.health_ready)
router.get("/metrics", response_class=PlainTextResponse)(endpoints.metrics_api)
router.get("/operations/{operation_id}")(endpoints.optimization_operation_detail_api)
router.get("/operations")(endpoints.optimization_operations_api)
