from __future__ import annotations

import json

from app.core.schemas import default_request
from app.services.backtest_engine import run_backtest
from app.services.data_loader import load_candles


def main() -> None:
    payload = default_request()
    candles = load_candles(payload.data)
    result = run_backtest(candles, payload.strategy)
    print(json.dumps(result.summary.model_dump(), indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
