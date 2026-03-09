from __future__ import annotations

from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)

    app_log_level: str = Field(default="INFO", alias="APP_LOG_LEVEL")
    cors_allow_origins_raw: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="CORS_ALLOW_ORIGINS",
    )
    backend_workers: Optional[int] = Field(default=None, alias="BACKEND_WORKERS")
    uvicorn_workers: Optional[int] = Field(default=None, alias="UVICORN_WORKERS")
    web_concurrency: Optional[int] = Field(default=None, alias="WEB_CONCURRENCY")

    app_auth_enabled: bool = Field(default=True, alias="APP_AUTH_ENABLED")
    app_public_mode: Optional[bool] = Field(default=None, alias="APP_PUBLIC_MODE")
    app_auth_api_keys: str = Field(default="", alias="APP_AUTH_API_KEYS")
    app_auth_bearer_tokens: str = Field(default="", alias="APP_AUTH_BEARER_TOKENS")
    app_auth_jwt_secret: str = Field(default="", alias="APP_AUTH_JWT_SECRET")
    app_auth_jwt_algorithm: str = Field(default="HS256", alias="APP_AUTH_JWT_ALGORITHM")
    app_auth_jwt_audience: str = Field(default="", alias="APP_AUTH_JWT_AUDIENCE")
    app_auth_jwt_issuer: str = Field(default="", alias="APP_AUTH_JWT_ISSUER")
    app_auth_jwt_role_claim: str = Field(default="role", alias="APP_AUTH_JWT_ROLE_CLAIM")
    app_auth_jwt_sub_claim: str = Field(default="sub", alias="APP_AUTH_JWT_SUB_CLAIM")

    app_rate_limit_enabled: bool = Field(default=True, alias="APP_RATE_LIMIT_ENABLED")
    app_rate_limit_write_rpm: int = Field(default=120, alias="APP_RATE_LIMIT_WRITE_RPM")
    app_rate_limit_ip_write_rpm: int = Field(default=240, alias="APP_RATE_LIMIT_IP_WRITE_RPM")
    app_rate_limit_bucket_ttl_seconds: int = Field(default=1800, alias="APP_RATE_LIMIT_BUCKET_TTL_SECONDS")
    app_rate_limit_window_seconds: int = Field(default=60, alias="APP_RATE_LIMIT_WINDOW_SECONDS")

    app_concurrency_limit_enabled: bool = Field(default=True, alias="APP_CONCURRENCY_LIMIT_ENABLED")
    app_concurrency_limit_per_subject: int = Field(default=2, alias="APP_CONCURRENCY_LIMIT_PER_SUBJECT")
    app_concurrency_limit_per_ip: int = Field(default=4, alias="APP_CONCURRENCY_LIMIT_PER_IP")
    app_concurrency_limit_global: int = Field(default=64, alias="APP_CONCURRENCY_LIMIT_GLOBAL")
    app_concurrency_limit_ttl_seconds: int = Field(default=300, alias="APP_CONCURRENCY_LIMIT_TTL_SECONDS")

    app_task_backend: str = Field(default="inmemory", alias="APP_TASK_BACKEND")
    app_backtest_task_backend: str = Field(default="", alias="APP_BACKTEST_TASK_BACKEND")
    app_optimization_task_backend: str = Field(default="", alias="APP_OPTIMIZATION_TASK_BACKEND")

    app_arq_queue_name: str = Field(default="grid-strategy-research-platform", alias="APP_ARQ_QUEUE_NAME")
    app_arq_max_jobs: int = Field(default=4, alias="APP_ARQ_MAX_JOBS")
    app_arq_job_timeout_seconds: int = Field(default=21600, alias="APP_ARQ_JOB_TIMEOUT_SECONDS")
    app_arq_enqueue_timeout_seconds: float = Field(default=5.0, alias="APP_ARQ_ENQUEUE_TIMEOUT_SECONDS")
    app_arq_redis_dsn: str = Field(default="redis://localhost:6379/0", alias="APP_ARQ_REDIS_DSN")

    app_state_redis_enabled: Optional[bool] = Field(default=None, alias="APP_STATE_REDIS_ENABLED")
    app_state_redis_required_in_arq: Optional[bool] = Field(default=None, alias="APP_STATE_REDIS_REQUIRED_IN_ARQ")
    app_state_redis_dsn: Optional[str] = Field(default=None, alias="APP_STATE_REDIS_DSN")

    optimization_selected_clear_max: int = Field(default=500, alias="OPTIMIZATION_SELECTED_CLEAR_MAX")
    optimization_selected_clear_max_public: int = Field(default=120, alias="OPTIMIZATION_SELECTED_CLEAR_MAX_PUBLIC")

    @property
    def cors_allow_origins(self) -> list[str]:
        origins = [item.strip() for item in self.cors_allow_origins_raw.split(",") if item.strip()]
        return origins or ["http://localhost:5173", "http://127.0.0.1:5173"]

    def configured_worker_count(self) -> int:
        for value in (self.backend_workers, self.uvicorn_workers, self.web_concurrency):
            if value is not None and value > 0:
                return value
        return 1



def get_settings() -> Settings:
    return Settings()
