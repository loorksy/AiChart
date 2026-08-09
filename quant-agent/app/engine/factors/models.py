"""Wire models for the factor endpoints, plus the wire-to-engine adapter.

Shapes derived from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Sources:
`backend_api_python/app/routes/factors.py` (`GET /api/factors`) and
`.../app/routes/agent_v1/research.py` (the agent catalogue).

Changed on port:

  * **Bars are pushed in.** Upstream reads its own database inside
    `compute_factor`'s caller; this service has no egress, so `POST
    .../factors/compute` carries the candles. That is the same push-not-pull
    model the recommendation and backtest endpoints already use.
  * **Fundamentals are pushed in too.** The seven fundamental factors read
    point-in-time columns (`market_cap`, `net_income`, ...) that no OHLCV bar
    carries. `fundamentals` is the channel for them. AiChart has no
    fundamentals feed today, so omitting it simply yields
    `factor.missingFields` — absent input reported as absent, never filled in
    with a plausible-looking number.
  * **A NaN result is serialized as `null`.** `float("nan")` is not valid JSON
    and upstream leans on Flask emitting the non-standard `NaN` literal.
    `value: null` with `is_nan: true` says the same thing in JSON a browser
    can parse: the factor has no defined value for these bars.

Following `app/engine/analysis/models.py`, these live in the engine package
rather than in `app/storage/models.py` because nothing here is persisted.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.engine.factors.frame import NAN, Frame
from app.storage.models import Bar

# A `period` may legitimately reach 5000 and `tema` needs three times that, so
# the ceiling is generous; the 2 MiB request cap is the real bound in practice.
MAX_COMPUTE_BARS = 20000
# Fundamentals are quarterly or annual: a decade is forty rows.
MAX_FUNDAMENTAL_ROWS = 500
MAX_FUNDAMENTAL_FIELDS = 32
MAX_PARAMS = 12

_FIELD_NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

# The column names OHLCV already occupies — a fundamentals row must not shadow
# a price series and quietly change what a technical factor computes on.
_RESERVED_COLUMNS = frozenset({"open", "high", "low", "close", "volume"})

ParamValue = str | int | float | bool | None


class FactorParameterSchema(BaseModel):
    """One entry of upstream's generated `parameter_schema`.

    The bounds are `int | float` rather than plain `float` so an integer
    parameter still serializes as `"minimum": 1`, the way upstream emits it —
    widening it to `1.0` would change the shape the factor-library UI binds its
    number inputs to.
    """

    model_config = ConfigDict(extra="forbid")
    type: str
    options: list[str] | None = None
    minimum: int | float | None = None
    maximum: int | float | None = None
    step: int | float | None = None


class FactorMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    factor_id: str
    version: str
    name: str
    name_i18n_key: str
    description_i18n_key: str
    category: str
    factor_type: str
    required_fields: list[str]
    default_params: dict[str, ParamValue]
    parameter_schema: dict[str, FactorParameterSchema]
    direction_hint: str
    supported_contexts: list[str]
    default_warmup_bars: int
    availability: str
    unavailable_reason: str


class FactorCatalogueMeta(BaseModel):
    """Upstream's `meta` block, degraded exactly as it degrades there when the
    TA-Lib C extension is missing: `talib_available` false, `talib_count` 0."""

    model_config = ConfigDict(extra="forbid")
    builtin_count: int
    returned_count: int
    available_count: int
    unavailable_count: int
    talib_available: bool = False
    talib_count: int = 0


class FactorListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[FactorMetadata]
    meta: FactorCatalogueMeta


class FactorComputeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    factor_id: str = Field(min_length=1, max_length=120)
    params: dict[str, ParamValue] = Field(default_factory=dict)
    bars: list[Bar] = Field(default_factory=list, max_length=MAX_COMPUTE_BARS)
    fundamentals: list[dict[str, float | None]] = Field(
        default_factory=list, max_length=MAX_FUNDAMENTAL_ROWS
    )

    @field_validator("params")
    @classmethod
    def _bounded_params(cls, value: dict[str, ParamValue]) -> dict[str, ParamValue]:
        if len(value) > MAX_PARAMS:
            raise ValueError(f"at most {MAX_PARAMS} parameters may be overridden")
        for key in value:
            if not _FIELD_NAME.match(key):
                raise ValueError(f"parameter name '{key}' is not a lower_snake_case identifier")
        return value

    @field_validator("fundamentals")
    @classmethod
    def _bounded_fundamentals(
        cls, value: list[dict[str, float | None]]
    ) -> list[dict[str, float | None]]:
        for row in value:
            if len(row) > MAX_FUNDAMENTAL_FIELDS:
                raise ValueError(f"at most {MAX_FUNDAMENTAL_FIELDS} fundamental fields per row")
            for key, entry in row.items():
                if not _FIELD_NAME.match(key):
                    raise ValueError(f"field name '{key}' is not a lower_snake_case identifier")
                if key in _RESERVED_COLUMNS:
                    raise ValueError(f"field name '{key}' is reserved for the bar series")
                if entry is not None and not math.isfinite(entry):
                    raise ValueError(f"field '{key}' must be a finite number or null")
        return value

    @model_validator(mode="after")
    def _aligned_rows(self) -> FactorComputeRequest:
        if not self.bars and not self.fundamentals:
            raise ValueError("either bars or fundamentals must be supplied")
        if self.bars and self.fundamentals and len(self.bars) != len(self.fundamentals):
            # Upstream aligns the two on a shared DataFrame index. There is no
            # index on the wire, so the caller must line the rows up itself
            # rather than have this service guess which quarter a bar belongs to.
            raise ValueError("fundamentals must have one row per bar when both are supplied")
        return self


class FactorComputeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    factor_id: str
    version: str
    value: float | None
    is_nan: bool
    params_used: dict[str, ParamValue]
    row_count: int


def build_frame(bars: Sequence[Bar], fundamentals: Sequence[dict[str, float | None]]) -> Frame:
    """Wire rows to the engine's `Frame`.

    A missing volume becomes NaN rather than 0: upstream's kernels distinguish
    the two deliberately (`_obv_series` fills to 0 before accumulating, while
    `_volume_ratio` drops the row entirely), and collapsing them here would
    silently invent a zero-volume bar.
    """
    row_count = max(len(bars), len(fundamentals))
    columns: dict[str, tuple[float, ...]] = {}
    if bars:
        columns["open"] = tuple(bar.open for bar in bars)
        columns["high"] = tuple(bar.high for bar in bars)
        columns["low"] = tuple(bar.low for bar in bars)
        columns["close"] = tuple(bar.close for bar in bars)
        columns["volume"] = tuple(NAN if bar.volume is None else bar.volume for bar in bars)
    if fundamentals:
        names: list[str] = []
        for row in fundamentals:
            names.extend(name for name in row if name not in names)
        for name in names:
            values: list[float] = []
            for row in fundamentals:
                entry = row.get(name)
                values.append(NAN if entry is None else float(entry))
            columns[name] = tuple(values)
    return Frame(columns=columns, row_count=row_count)
