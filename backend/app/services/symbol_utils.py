from __future__ import annotations

import re

from app.core.schemas import DataSource

_SEPARATOR_PATTERN = re.compile(r"[\s/_:]+")


def _compact_symbol(raw: str) -> str:
    compact = _SEPARATOR_PATTERN.sub("", raw).replace("-", "")
    if compact.endswith("PERP"):
        compact = compact.removesuffix("PERP")
    if compact.endswith("SWAP"):
        compact = compact.removesuffix("SWAP")
    return compact


def normalize_symbol_for_source(source: DataSource, symbol: str) -> str:
    raw = (symbol or "").strip().upper()
    if not raw:
        raise ValueError("交易对不能为空")

    # Support inputs like BTC-USDT-SWAP / BTCUSDT-PERP / BTC/USDT.
    compact = _compact_symbol(raw)
    if not compact or not compact.isalnum():
        raise ValueError(f"交易对格式不正确：{symbol}")

    if source in {DataSource.BINANCE, DataSource.BYBIT} and len(compact) < 6:
        raise ValueError(f"交易对格式不正确：{symbol}")

    return compact


def symbol_not_found_message(source: DataSource, symbol: str) -> str:
    exchange = {
        DataSource.BINANCE: "Binance",
        DataSource.BYBIT: "Bybit",
        DataSource.OKX: "OKX",
        DataSource.CSV: "CSV",
    }.get(source, source.value)
    return f"交易对不存在或 {exchange} 不支持：{symbol}"


def looks_like_symbol_not_found_error(message: str) -> bool:
    lowered = message.lower()
    needles = (
        "invalid symbol",
        "symbol invalid",
        "symbol is invalid",
        "unknown symbol",
        "instrument id doesn't exist",
        "instid",
        "does not exist",
        "not found",
    )
    return any(token in lowered for token in needles)
