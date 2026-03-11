from __future__ import annotations

import pytest

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

    result = market_params.fetch_market_params(DataSource.BINANCE, "btc/usdt")
    assert result.source == DataSource.BINANCE
    assert result.symbol == "BTCUSDT"
    assert result.maker_fee_rate == 0.0002
    assert result.taker_fee_rate == 0.0004
    assert result.funding_rate_per_8h == 0.0003
    assert result.price_tick_size == 0.5
    assert result.quantity_step_size == 0.001
    assert result.min_notional == 10.0
    assert result.note is None


def test_fetch_market_params_invalid_symbol_raises_not_found(monkeypatch) -> None:
    market_params._MARKET_PARAMS_CACHE.clear()

    def fake_request_json(url: str, *, params: dict, timeout: int = 10):
        if url == market_params.BINANCE_EXCHANGE_INFO:
            raise RuntimeError("Invalid symbol.")
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(market_params, "_request_json", fake_request_json)

    with pytest.raises(ValueError, match="交易对不存在"):
        market_params.fetch_market_params(DataSource.BINANCE, "NOT_A_SYMBOL")


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


def test_fetch_market_params_okx_converts_min_notional_to_quote_ccy(monkeypatch) -> None:
    market_params._MARKET_PARAMS_CACHE.clear()

    def fake_request_json(url: str, *, params: dict, timeout: int = 10):
        if url == market_params.OKX_INSTRUMENT_INFO:
            return {
                "data": [
                    {
                        "tickSz": "0.1",
                        "lotSz": "0.01",
                        "minSz": "0.01",
                        "ctVal": "0.01",
                        "ctValCcy": "BTC",
                    }
                ]
            }
        if url == market_params.OKX_TICKER:
            return {
                "data": [
                    {
                        "last": "70000",
                        "markPx": "69990",
                    }
                ]
            }
        if url == market_params.OKX_FUNDING_RATE:
            return {"data": [{"fundingRate": "0.0002"}]}
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(market_params, "_request_json", fake_request_json)

    result = market_params.fetch_market_params(DataSource.OKX, "BTCUSDT")
    assert result.source == DataSource.OKX
    assert result.symbol == "BTCUSDT"
    assert result.price_tick_size == 0.1
    assert result.contract_size_base == 0.01
    # quantity_step_size should be converted from contract step to base-asset step:
    # lotSz * ctVal = 0.01 * 0.01 BTC = 0.0001 BTC
    assert result.quantity_step_size == 0.0001
    assert result.funding_rate_per_8h == 0.0002
    # min_notional = minSz * ctVal * last = 0.01 * 0.01 * 70000 = 7.0 USDT
    assert result.min_notional == 7.0
