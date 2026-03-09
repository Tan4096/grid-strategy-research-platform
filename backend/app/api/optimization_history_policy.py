from __future__ import annotations

from app.core.settings import get_settings



def selected_clear_limit(is_public: bool) -> int:
    settings = get_settings()
    default_limit = max(1, settings.optimization_selected_clear_max)
    if not is_public:
        return default_limit
    public_limit = max(1, settings.optimization_selected_clear_max_public)
    return min(default_limit, public_limit)
