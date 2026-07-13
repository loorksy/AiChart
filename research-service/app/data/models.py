from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictDataModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
        allow_inf_nan=False,
    )


class Timeframe(StrEnum):
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"


TIMEFRAME_SECONDS: dict[Timeframe, int] = {
    Timeframe.M1: 60,
    Timeframe.M5: 5 * 60,
    Timeframe.M15: 15 * 60,
    Timeframe.M30: 30 * 60,
    Timeframe.H1: 60 * 60,
    Timeframe.H4: 4 * 60 * 60,
    Timeframe.D1: 24 * 60 * 60,
}


def _validate_price_group(values: tuple[Decimal, Decimal, Decimal, Decimal], label: str) -> None:
    open_price, high, low, close = values
    if any(not value.is_finite() or value <= 0 for value in values):
        raise ValueError(f"{label} prices must be finite and positive")
    if high < max(open_price, low, close) or low > min(open_price, high, close):
        raise ValueError(f"invalid {label} OHLC relationship")


class CanonicalBar(StrictDataModel):
    """A normalized bar. ``timestamp`` is the UTC bar-open time."""

    timestamp: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal | None
    spread: Decimal | None
    symbol: str = Field(min_length=6, max_length=6, pattern=r"^[A-Z]{6}$")
    timeframe: Timeframe
    source: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    bid_open: Decimal | None = None
    bid_high: Decimal | None = None
    bid_low: Decimal | None = None
    bid_close: Decimal | None = None
    ask_open: Decimal | None = None
    ask_high: Decimal | None = None
    ask_low: Decimal | None = None
    ask_close: Decimal | None = None
    tick_volume: Decimal | None = None
    real_volume: Decimal | None = None
    timezone: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("timestamp")
    @classmethod
    def timestamp_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must be timezone-aware")
        return value.astimezone(UTC)

    @field_validator(
        "open",
        "high",
        "low",
        "close",
        "bid_open",
        "bid_high",
        "bid_low",
        "bid_close",
        "ask_open",
        "ask_high",
        "ask_low",
        "ask_close",
    )
    @classmethod
    def prices_are_finite(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and (not value.is_finite() or value <= 0):
            raise ValueError("prices must be finite and positive")
        return value

    @field_validator("volume", "spread", "tick_volume", "real_volume")
    @classmethod
    def non_negative_values(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and (not value.is_finite() or value < 0):
            raise ValueError("volume and spread values must be finite and non-negative")
        return value

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("unknown IANA timezone") from exc
        return value

    @model_validator(mode="after")
    def valid_ohlc(self) -> CanonicalBar:
        _validate_price_group((self.open, self.high, self.low, self.close), "mid")
        bid = (self.bid_open, self.bid_high, self.bid_low, self.bid_close)
        ask = (self.ask_open, self.ask_high, self.ask_low, self.ask_close)
        if any(item is not None for item in bid):
            if any(item is None for item in bid):
                raise ValueError("bid OHLC must be complete")
            bid_values = cast(tuple[Decimal, Decimal, Decimal, Decimal], bid)
            _validate_price_group(bid_values, "bid")
        if any(item is not None for item in ask):
            if any(item is None for item in ask):
                raise ValueError("ask OHLC must be complete")
            ask_values = cast(tuple[Decimal, Decimal, Decimal, Decimal], ask)
            _validate_price_group(ask_values, "ask")
        if all(item is not None for item in (*bid, *ask)):
            bid_values = cast(tuple[Decimal, Decimal, Decimal, Decimal], bid)
            ask_values = cast(tuple[Decimal, Decimal, Decimal, Decimal], ask)
            if any(
                bid_value > ask_value
                for bid_value, ask_value in zip(bid_values, ask_values, strict=True)
            ):
                raise ValueError("bid price cannot exceed ask price")
        return self


class GapRecord(StrictDataModel):
    symbol: str
    timeframe: Timeframe
    previous_timestamp: datetime
    next_timestamp: datetime
    missing_intervals: int = Field(gt=0)
    gap_seconds: int = Field(gt=0)


class CanonicalDataset(StrictDataModel):
    source: str
    bars: tuple[CanonicalBar, ...] = Field(min_length=1)
    dataset_hash: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def source_matches_bars(self) -> CanonicalDataset:
        if any(bar.source != self.source for bar in self.bars):
            raise ValueError("dataset source must match every bar")
        return self


class DatasetQualityReport(StrictDataModel):
    row_count: int = Field(ge=0)
    start_time: datetime | None
    end_time: datetime | None
    duplicates: int = Field(ge=0)
    invalid_rows: int = Field(ge=0)
    missing_intervals: int = Field(ge=0)
    largest_gap: int | None = Field(default=None, gt=0)
    spread_coverage: float = Field(ge=0, le=1)
    volume_coverage: float = Field(ge=0, le=1)
    source: str
    dataset_hash: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


class DatasetValidationResult(StrictDataModel):
    dataset: CanonicalDataset
    quality: DatasetQualityReport
    gaps: tuple[GapRecord, ...]


class DatasetLimits(StrictDataModel):
    max_rows: int = Field(default=250_000, ge=1, le=2_000_000)
    max_file_bytes: int = Field(default=32 * 1024 * 1024, ge=1024, le=256 * 1024 * 1024)
    max_symbols: int = Field(default=20, ge=1, le=100)
    max_date_range_days: int = Field(default=3660, ge=1, le=20_000)
    parquet_batch_rows: int = Field(default=4096, ge=128, le=65_536)
