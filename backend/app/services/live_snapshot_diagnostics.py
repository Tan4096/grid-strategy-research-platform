from __future__ import annotations

from app.core.schemas import LiveDiagnostic


def action_hint_for_code(code: str) -> str | None:
    mapping = {
        "fills_truncated": "shrink_time_window",
        "LIVE_BOT_FILLS_CAPPED": "shrink_time_window",
        "fills_not_available": "retry_sync",
        "LIVE_BOT_ORDERS_UNAVAILABLE": "retry_sync",
        "LIVE_BOT_SNAPSHOT_STALE": "retry_sync",
        "funding_truncated": "shrink_time_window",
        "funding_window_clipped": "shrink_time_window",
        "market_params_unavailable": "retry_sync",
        "funding_not_available": "retry_sync",
        "funding_empty": "review_time_window",
        "funding_source": "review_ledger",
        "pnl_curve_kline_unavailable": "retry_sync",
        "pnl_curve_fills_incomplete": "review_ledger",
        "pnl_curve_replay_available": "review_ledger",
        "pnl_curve_simulated": "review_ledger",
        "pnl_curve_simulation_unavailable": "retry_sync",
    }
    return mapping.get(code)


def build_diag(level: str, code: str, message: str) -> LiveDiagnostic:
    return LiveDiagnostic(
        level=level,
        code=code,
        message=message,
        action_hint=action_hint_for_code(code),
    )


def sanitize_error_message(value: str) -> str:
    sanitized = (value or "请求失败").strip()
    for token in ("api_secret", "passphrase", "signature", "secret"):
        sanitized = sanitized.replace(token, "***")
        sanitized = sanitized.replace(token.upper(), "***")
    return sanitized[:240] if len(sanitized) > 240 else sanitized


def normalize_diagnostics(diagnostics: list[LiveDiagnostic]) -> list[LiveDiagnostic]:
    normalized: list[LiveDiagnostic] = []
    for item in diagnostics:
        normalized.append(
            LiveDiagnostic(
                level=item.level,
                code=item.code,
                message=item.message,
                action_hint=item.action_hint or action_hint_for_code(item.code),
            )
        )
    return normalized
