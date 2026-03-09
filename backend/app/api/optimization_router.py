from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api import routes as endpoints

router = APIRouter(tags=["optimization"])
router.post("/optimization/start")(endpoints.start_optimization_api)
router.get("/optimization/{job_id}")(endpoints.optimization_status_api)
router.get("/optimization/{job_id}/rows")(endpoints.optimization_rows_api)
router.get("/optimization/{job_id}/heatmap")(endpoints.optimization_heatmap_api)
router.get("/optimization/{job_id}/progress")(endpoints.optimization_progress_api)
router.get("/optimization-history")(endpoints.optimization_history_api)
router.delete("/optimization-history")(endpoints.optimization_history_clear_api)
router.delete("/optimization-history/selected")(endpoints.optimization_history_selected_clear_api)
router.post("/optimization-history/restore-selected")(endpoints.optimization_history_selected_restore_api)
router.post("/optimization/{job_id}/cancel")(endpoints.optimization_cancel_api)
router.post("/optimization/{job_id}/restart")(endpoints.optimization_restart_api)
router.get("/optimization/{job_id}/export", response_class=StreamingResponse)(endpoints.optimization_export_api)
