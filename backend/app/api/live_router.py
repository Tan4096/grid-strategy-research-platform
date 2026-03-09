from __future__ import annotations

from fastapi import APIRouter

from app.api import routes as endpoints

router = APIRouter(tags=["live"])
router.post("/live/robots")(endpoints.live_robot_list_api)
router.post("/live/snapshot")(endpoints.live_snapshot_api)
