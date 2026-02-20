from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router

app = FastAPI(
    title="Crypto永续网格回测工具 API",
    version="1.0.0",
    description="Professional crypto perpetual futures grid strategy backtesting API",
)

origins_raw = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allow_origins = [item.strip() for item in origins_raw.split(",") if item.strip()]
if not allow_origins:
    allow_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
allow_credentials = allow_origins != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
