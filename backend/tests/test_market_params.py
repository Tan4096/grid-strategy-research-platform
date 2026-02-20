from __future__ import annotations

from app.core.schemas import DataSource
from app.services import market_params


def test_fetch_market_params_binance_uses_exchange_payload(monkeypatch) -> None:
    def fake_fetch(symbol: str):
        assert symbol == "BTCUSDT"
        return (
            {
                "funding_rate_per_8h": 0.0003,
                "price_tick_size": 0.5,
                "quantity_step_size": 0.001,
                "min_notional": 10.0,
            },
            [],
        )

    monkeypatch.setattr(market_params, "_fetch_binance", fake_fetch)

    result = market_params.fetch_market_params(DataSource.BINANCE, "btcusdt")
    assert result.source == DataSource.BINANCE
    assert result.symbol == "BTCUSDT"
    assert result.maker_fee_rate == 0.0002
    assert result.taker_fee_rate == 0.0004
    assert result.funding_rate_per_8h == 0.0003
    assert result.price_tick_size == 0.5
    assert result.quantity_step_size == 0.001
    assert result.min_notional == 10.0
    assert result.note is None


def test_fetch_market_params_csv_uses_fallback_defaults() -> None:
    result = market_params.fetch_market_params(DataSource.CSV, "ETHUSDT")
    assert result.source == DataSource.CSV
    assert result.symbol == "ETHUSDT"
    assert result.maker_fee_rate == 0.0002
    assert result.taker_fee_rate == 0.0004
    assert result.funding_rate_per_8h == 0.0
    assert result.price_tick_size == 0.1
    assert result.quantity_step_size == 0.0001
    assert result.min_notional == 5.0
    assert result.note is not None
