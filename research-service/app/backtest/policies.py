from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from app.errors import ServiceError
from app.strategies.models import SYMBOL_REGISTRY as _STRATEGY_SYMBOLS

ENGINE_VERSION = "aichart-forex-v1"
INDICATOR_VERSION = "aichart-indicators-v1"

TIMEFRAME_MINUTES = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 1440,
}


@dataclass(frozen=True, slots=True)
class SymbolMetadata:
    symbol: str
    digits: int
    pip_size: float
    tick_size: float
    contract_size: float
    base_currency: str
    quote_currency: str
    pip_value_method: str
    minimum_lot: float
    lot_step: float


_SYMBOLS = {
    symbol: SymbolMetadata(
        symbol=item.symbol,
        digits=item.digits,
        pip_size=item.pip_size,
        tick_size=item.tick_size,
        contract_size=item.contract_size,
        base_currency=item.base_currency,
        quote_currency=item.quote_currency,
        pip_value_method="quote" if item.quote_currency == "USD" else "conversion_required",
        minimum_lot=item.minimum_lot,
        lot_step=item.lot_step,
    )
    for symbol, item in _STRATEGY_SYMBOLS.items()
}


def normalize_symbol(value: str) -> str:
    normalized = "".join(ch for ch in value.upper() if ch.isalnum())
    if normalized not in _SYMBOLS:
        raise ServiceError("JOB_INPUT_INVALID", "unsupported Forex symbol metadata", 422)
    return normalized


def symbol_metadata(symbol: str) -> SymbolMetadata:
    return _SYMBOLS[normalize_symbol(symbol)]


def supported_symbols() -> tuple[str, ...]:
    return tuple(sorted(_SYMBOLS))


def round_lot(value: float, metadata: SymbolMetadata) -> float:
    if value < metadata.minimum_lot:
        return 0.0
    steps = int((value + 1e-12) / metadata.lot_step)
    return round(steps * metadata.lot_step, 8)


def annual_periods(timeframe: str) -> int:
    minutes = TIMEFRAME_MINUTES[timeframe]
    if timeframe == "1d":
        return 260
    return round(52 * 5 * 24 * 60 / minutes)


def forex_session(timestamp: datetime) -> str:
    """DST-aware descriptive session label; holidays remain out of scope."""
    utc = timestamp.astimezone(ZoneInfo("UTC"))
    london = utc.astimezone(ZoneInfo("Europe/London"))
    new_york = utc.astimezone(ZoneInfo("America/New_York"))
    tokyo = utc.astimezone(ZoneInfo("Asia/Tokyo"))
    sessions: list[str] = []
    if 8 <= tokyo.hour < 17:
        sessions.append("asia")
    if 8 <= london.hour < 17:
        sessions.append("london")
    if 8 <= new_york.hour < 17:
        sessions.append("new_york")
    return "+".join(sessions) if sessions else "off_session"


def forex_market_open(timestamp: datetime) -> bool:
    """Weekend-only Forex calendar using the DST-aware New York 17:00 boundary."""

    local = timestamp.astimezone(ZoneInfo("America/New_York"))
    weekday = local.weekday()
    if weekday == 5:
        return False
    if weekday == 4:
        return local.hour < 17
    if weekday == 6:
        return local.hour >= 17
    return True
