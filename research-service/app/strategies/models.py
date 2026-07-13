from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FrozenStrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
        allow_inf_nan=False,
        str_strip_whitespace=True,
    )


class Market(StrEnum):
    FOREX = "forex"


class Timeframe(StrEnum):
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"


TIMEFRAME_MINUTES: dict[Timeframe, int] = {
    Timeframe.M1: 1,
    Timeframe.M5: 5,
    Timeframe.M15: 15,
    Timeframe.M30: 30,
    Timeframe.H1: 60,
    Timeframe.H4: 240,
    Timeframe.D1: 1440,
}


class Direction(StrEnum):
    LONG = "long"
    SHORT = "short"
    BOTH = "both"


class StrategyVersionStatus(StrEnum):
    DRAFT = "draft"
    VALID = "valid"
    INVALID = "invalid"
    DEPRECATED = "deprecated"


class PipValueMethod(StrEnum):
    QUOTE_CURRENCY = "quote_currency"


class SymbolMetadata(FrozenStrictModel):
    symbol: str = Field(pattern=r"^[A-Z]{6}$")
    digits: int = Field(ge=0, le=8)
    pip_size: float = Field(gt=0)
    tick_size: float = Field(gt=0)
    contract_size: float = Field(gt=0)
    quote_currency: str = Field(pattern=r"^[A-Z]{3}$")
    base_currency: str = Field(pattern=r"^[A-Z]{3}$")
    pip_value_method: PipValueMethod
    minimum_lot: float = Field(gt=0)
    lot_step: float = Field(gt=0)


_FOREX_PAIRS = (
    "AUDCAD",
    "AUDCHF",
    "AUDJPY",
    "AUDNZD",
    "AUDUSD",
    "CADCHF",
    "CADJPY",
    "CHFJPY",
    "EURAUD",
    "EURCAD",
    "EURCHF",
    "EURGBP",
    "EURJPY",
    "EURNZD",
    "EURUSD",
    "GBPAUD",
    "GBPCAD",
    "GBPCHF",
    "GBPJPY",
    "GBPNZD",
    "GBPUSD",
    "NZDCAD",
    "NZDCHF",
    "NZDJPY",
    "NZDUSD",
    "USDCAD",
    "USDCHF",
    "USDJPY",
)


def _forex_metadata(symbol: str) -> SymbolMetadata:
    quote = symbol[3:]
    jpy = quote == "JPY"
    return SymbolMetadata(
        symbol=symbol,
        digits=3 if jpy else 5,
        pip_size=0.01 if jpy else 0.0001,
        tick_size=0.001 if jpy else 0.00001,
        contract_size=100_000.0,
        quote_currency=quote,
        base_currency=symbol[:3],
        pip_value_method=PipValueMethod.QUOTE_CURRENCY,
        minimum_lot=0.01,
        lot_step=0.01,
    )


SYMBOL_REGISTRY: dict[str, SymbolMetadata] = {
    symbol: _forex_metadata(symbol) for symbol in _FOREX_PAIRS
}
SYMBOL_REGISTRY["XAUUSD"] = SymbolMetadata(
    symbol="XAUUSD",
    digits=2,
    pip_size=0.01,
    tick_size=0.01,
    contract_size=100.0,
    quote_currency="USD",
    base_currency="XAU",
    pip_value_method=PipValueMethod.QUOTE_CURRENCY,
    minimum_lot=0.01,
    lot_step=0.01,
)


class StrategyDefinition(FrozenStrictModel):
    strategy_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2_000)
    market: Market
    symbols: tuple[str, ...] = Field(min_length=1, max_length=20)
    enabled: bool
    created_by_user_id: int = Field(gt=0)
    created_at: datetime
    latest_version_id: str | None = Field(
        default=None, min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"
    )

    @field_validator("created_at")
    @classmethod
    def aware_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at must be timezone-aware")
        return value.astimezone(UTC)


class StrategyVersion(FrozenStrictModel):
    strategy_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    version_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    version_number: int = Field(ge=1, le=1_000_000)
    parent_version_id: str | None = Field(
        default=None, min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$"
    )
    spec_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    canonical_spec: dict[str, Any]
    spec_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    created_by_user_id: int = Field(gt=0)
    created_at: datetime
    status: StrategyVersionStatus
    change_summary: str = Field(default="", max_length=1_000)

    @field_validator("created_at")
    @classmethod
    def aware_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at must be timezone-aware")
        return value.astimezone(UTC)


class StrategyValidationResult(FrozenStrictModel):
    valid: bool
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    canonical_spec: dict[str, Any] | None = None
    spec_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class BacktestRunReference(FrozenStrictModel):
    run_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    strategy_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    version_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    spec_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    created_by_user_id: int = Field(gt=0)
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def aware_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at must be timezone-aware")
        return value.astimezone(UTC)
