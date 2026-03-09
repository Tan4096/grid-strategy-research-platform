from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.schemas import DataConfig, DataSource, Interval
from app.services import data_loader


def test_okx_history_pagination_does_not_skip_hourly_candles(monkeypatch) -> None:
    start_utc = datetime(2026, 2, 11, 0, 0, tzinfo=timezone.utc)
    end_utc = start_utc + timedelta(hours=10)
    interval_ms = 60 * 60 * 1000
    all_ts = [int((start_utc + timedelta(hours=i)).timestamp() * 1000) for i in range(10)]

    def fake_request_json(url: str, *, params: dict[str, object], provider: str, timeout: int = 15):
        assert url == data_loader.OKX_HISTORY_CANDLES
        assert provider == "OKX"

        after_ms = int(params["after"])
        # Simulate OKX: return candles strictly older than `after`, newest-first.
        older = sorted((ts for ts in all_ts if ts < after_ms), reverse=True)
        chunk = older[:3]
        if not chunk:
            return {"code": "0", "data": []}

        return {
            "code": "0",
            "data": [[str(ts), "1", "2", "0.5", "1.5", "100"] for ts in chunk],
        }

    monkeypatch.setattr(data_loader, "_request_json", fake_request_json)

    cfg = DataConfig(
        source=DataSource.OKX,
        symbol="BTCUSDT",
        interval=Interval.H1,
        lookback_days=1,
    )

    candles = data_loader.load_from_okx(cfg, start_utc=start_utc, end_utc=end_utc)
    timestamps = [item.timestamp for item in candles]

    expected = [start_utc + timedelta(hours=i) for i in range(10)]
    assert timestamps == expected
    assert timestamps[6] == datetime(2026, 2, 11, 6, 0, tzinfo=timezone.utc)
    assert all(
        (timestamps[idx + 1] - timestamps[idx]).total_seconds() == interval_ms / 1000
        for idx in range(len(timestamps) - 1)
    )


def test_okx_mark_price_pagination_loads_hourly_candles(monkeypatch) -> None:
    start_utc = datetime(2026, 2, 11, 0, 0, tzinfo=timezone.utc)
    end_utc = start_utc + timedelta(hours=6)
    all_ts = [int((start_utc + timedelta(hours=i)).timestamp() * 1000) for i in range(6)]

    def fake_request_json(url: str, *, params: dict[str, object], provider: str, timeout: int = 15):
        assert url == data_loader.OKX_HISTORY_MARK_PRICE_CANDLES
        assert provider == "OKX"

        after_ms = int(params["after"])
        older = sorted((ts for ts in all_ts if ts < after_ms), reverse=True)
        chunk = older[:2]
        if not chunk:
            return {"code": "0", "data": []}

        return {
            "code": "0",
            "data": [[str(ts), "1", "2", "0.5", "1.5", "1"] for ts in chunk],
        }

    monkeypatch.setattr(data_loader, "_request_json", fake_request_json)

    cfg = DataConfig(
        source=DataSource.OKX,
        symbol="BTCUSDT",
        interval=Interval.H1,
        lookback_days=1,
    )

    candles = data_loader.load_mark_price_candles(cfg, start_utc=start_utc, end_utc=end_utc)
    timestamps = [item.timestamp for item in candles]
    expected = [start_utc + timedelta(hours=i) for i in range(6)]
    assert timestamps == expected
    assert all(item.volume == 0.0 for item in candles)
