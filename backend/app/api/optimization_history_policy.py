from __future__ import annotations

import os


def _int_env(name: str, default: int, minimum: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return max(minimum, default)
    try:
        return max(minimum, int(raw))
    except ValueError:
        return max(minimum, default)


def selected_clear_limit(is_public: bool) -> int:
    default_limit = _int_env("OPTIMIZATION_SELECTED_CLEAR_MAX", default=500, minimum=1)
    if not is_public:
        return default_limit
    public_limit = _int_env("OPTIMIZATION_SELECTED_CLEAR_MAX_PUBLIC", default=120, minimum=1)
    return min(default_limit, public_limit)
