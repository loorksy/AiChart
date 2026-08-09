"""The declarative factor registry: one shape, 61 built-in declarations.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/factors/registry.py` (`FactorDefinition`,
`_technical`, `_fundamental`, `_technical_warmup`, `_parameter_schema`,
`_OUTPUT_OPTIONS`, `_FACTORS`, `list_factors`, `get_factor`, `compute_factor`,
`compute_panel_factor`).

The declaration table below is upstream's, in upstream's order, with upstream's
categories, direction hints, required fields, defaults and warm-up arithmetic.
Four things changed on the port:

  * **`version` is real.** Upstream hard-codes the literal `"1.0.0"` on all 61
    factors: there is no bump mechanism, the version is in no cache key, and a
    formula change therefore invalidates stored research silently. Here each
    declaration carries its own version, `tests/test_factors_version.py`
    freezes the `(factor_id, version)` table alongside a fingerprint of the
    kernel's own source, and changing a formula without bumping fails CI. All
    61 start at `"1.0.0"` so today's numbers are upstream's numbers.
  * **`availability` is explicit.** This service has no TA-Lib and no network,
    so a factor that could not be reproduced would have to say so rather than
    disappear from the catalogue or be quietly approximated. Every built-in
    turned out to be reproducible in pure Python, so all 61 are `available`;
    the field exists because the honest answer has to be representable, and
    `GET /internal/quant-agent/factors` reports `talib_available: false` so a
    client ported from QuantDinger degrades exactly as it does upstream when
    the C extension is missing.
  * **`name` is carried inline.** Upstream stores only `factor.{id}.name` and
    resolves it in the Vue client's locale files. The English display name is
    kept here (taken verbatim from QuantDinger's `en-US.js`) so the catalogue
    is usable without a locale round-trip; `name_i18n_key` is still emitted so
    AiChart's own Arabic/English dictionaries stay the source of truth for the
    UI. Descriptions are NOT carried — prose belongs to `web/`'s i18n layer,
    the same call Wave 1 made.
  * **`metadata()` emits lists, not tuples.** Upstream leans on Flask's
    `jsonify` to widen `required_fields` / `supported_contexts`; FastAPI's
    response model would too, but being explicit keeps the shape obvious.

`parameter_schema` is reproduced from upstream's generator unchanged, INCLUDING
its known inconsistency: it advertises `minimum: 1` for every integer, while
`compute.py`'s `_period` guard actually rejects anything below 2 for most
parameters. The schema is the frozen wire contract the factor-library UI
renders; the compute path is the authority. Not "fixed" here, because a port
that silently tightens a published schema is not a port.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from app.engine.factors.compute import (
    _ad_line,
    _adx,
    _amihud_illiquidity,
    _aroon,
    _atr,
    _atr_pct,
    _awesome_oscillator,
    _bollinger,
    _cci,
    _chaikin,
    _choppiness,
    _cmf,
    _cmo,
    _dema,
    _donchian,
    _downside_volatility,
    _efficiency_ratio,
    _elder_ray,
    _ema,
    _ema_slope,
    _force_index,
    _garman_klass_volatility,
    _growth_last,
    _hma,
    _kama,
    _kdj,
    _keltner,
    _last_value,
    _ma_distance,
    _macd,
    _max_drawdown,
    _mfi,
    _obv,
    _parkinson_volatility,
    _ppo,
    _ratio_last,
    _realized_vol,
    _return,
    _rsi,
    _sma,
    _stochastic,
    _supertrend,
    _tema,
    _trix,
    _tsi,
    _turnover,
    _ulcer_index,
    _ultimate_oscillator,
    _volume_ratio,
    _vortex,
    _vwap,
    _williams_r,
    _zlema,
    _zscore_last,
)
from app.engine.factors.frame import NAN, FactorError, Frame

Availability = Literal["available", "unavailable"]

ComputeKernel = Callable[[Frame, Mapping[str, Any]], float]

# Ids namespaced into TA-Lib's catalogue. The C extension is not installed here
# and reimplementing it is out of scope (see `NOTICE.md`), so these resolve to
# upstream's own "TA-Lib is missing" code rather than to `factor.notFound` —
# the difference between "no such factor" and "that factor needs TA-Lib".
TALIB_PREFIX = "talib:"


@dataclass(frozen=True)
class FactorDefinition:
    factor_id: str
    version: str
    name: str
    name_i18n_key: str
    description_i18n_key: str
    category: str
    factor_type: str
    required_fields: tuple[str, ...]
    default_params: dict[str, Any] = field(default_factory=dict)
    parameter_schema: dict[str, dict[str, Any]] = field(default_factory=dict)
    direction_hint: str = "neutral"
    supported_contexts: tuple[str, ...] = ("portfolio",)
    default_warmup_bars: int = 0
    availability: Availability = "available"
    unavailable_reason: str = ""
    compute: ComputeKernel | None = field(repr=False, compare=False, default=None)

    def metadata(self) -> dict[str, Any]:
        return {
            "factor_id": self.factor_id,
            "version": self.version,
            "name": self.name,
            "name_i18n_key": self.name_i18n_key,
            "description_i18n_key": self.description_i18n_key,
            "category": self.category,
            "factor_type": self.factor_type,
            "required_fields": list(self.required_fields),
            "default_params": dict(self.default_params),
            "parameter_schema": {key: dict(value) for key, value in self.parameter_schema.items()},
            "direction_hint": self.direction_hint,
            "supported_contexts": list(self.supported_contexts),
            "default_warmup_bars": self.default_warmup_bars,
            "availability": self.availability,
            "unavailable_reason": self.unavailable_reason,
        }


def _technical_warmup(factor_id: str, params: Mapping[str, Any]) -> int:
    """Upstream's advisory warm-up estimate, reproduced branch for branch.

    It is metadata only — `compute_factor` does not enforce it; each kernel
    raises `factor.insufficientHistory` on its own terms.
    """
    period = int(params.get("period") or 1)
    if factor_id in {"momentum", "roc", "rsi", "downside_volatility"}:
        return period + 1
    if factor_id == "ema_slope":
        return period + int(params.get("slope_period") or 1)
    if factor_id == "macd":
        return int(params.get("slow_period") or 26) + int(params.get("signal_period") or 9)
    if factor_id == "stochastic":
        return period + int(params.get("smooth_k") or 1) + int(params.get("smooth_d") or 1) - 2
    if factor_id == "trix":
        return period * 3 + 1
    if factor_id == "dema":
        return period * 2
    if factor_id == "tema":
        return period * 3
    if factor_id == "hma":
        return period + int(math.sqrt(period))
    if factor_id in {"cmo", "efficiency_ratio", "kama", "ulcer_index", "choppiness", "vortex"}:
        return period + 1
    if factor_id in {"ppo", "awesome_oscillator"}:
        return int(params.get("slow_period") or period)
    if factor_id == "ultimate_oscillator":
        return int(params.get("slow_period") or 28) + 1
    if factor_id == "tsi":
        return int(params.get("slow_period") or 25) + int(params.get("fast_period") or 13) + 1
    if factor_id == "adx":
        return period * 2
    if factor_id == "chaikin_oscillator":
        return int(params.get("slow_period") or 10)
    if factor_id in {"obv", "ad_line"}:
        return period + 1
    return max(1, period)


# The `output` parameter's allowed values, per factor. Every id listed here
# also declares an `output` default, so all 14 render as enums.
_OUTPUT_OPTIONS: dict[str, tuple[str, ...]] = {
    "ad_line": ("value", "slope"),
    "adx": ("adx", "plus_di", "minus_di"),
    "aroon": ("up", "down", "oscillator"),
    "bollinger_bands": ("upper", "middle", "lower", "bandwidth", "position"),
    "donchian_channels": ("upper", "middle", "lower", "position"),
    "elder_ray": ("bull", "bear"),
    "kdj": ("k", "d", "j"),
    "keltner_channels": ("upper", "middle", "lower", "position"),
    "macd": ("line", "signal", "histogram"),
    "obv": ("value", "slope"),
    "stochastic": ("k", "d"),
    "supertrend": ("direction", "line"),
    "vwap": ("value", "distance"),
    "vortex": ("plus", "minus", "oscillator"),
}


def _parameter_schema(factor_id: str, params: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Upstream's schema generator. `bool` is tested before `int` on purpose —
    in Python a `bool` IS an `int`, and the order is what makes a flag render
    as a switch rather than as a spinner."""
    schema: dict[str, dict[str, Any]] = {}
    for key, value in params.items():
        if key == "output" and factor_id in _OUTPUT_OPTIONS:
            schema[key] = {"type": "enum", "options": list(_OUTPUT_OPTIONS[factor_id])}
        elif isinstance(value, bool):
            schema[key] = {"type": "boolean"}
        elif isinstance(value, int):
            schema[key] = {"type": "integer", "minimum": 1, "maximum": 5000, "step": 1}
        elif isinstance(value, float):
            schema[key] = {"type": "number", "minimum": 0.000001, "step": 0.1}
        else:
            schema[key] = {"type": "string"}
    return schema


def _technical(
    factor_id: str,
    name: str,
    category: str,
    fields: tuple[str, ...],
    params: dict[str, Any],
    direction: str,
    compute: ComputeKernel,
    *,
    version: str = "1.0.0",
) -> FactorDefinition:
    return FactorDefinition(
        factor_id=factor_id,
        version=version,
        name=name,
        name_i18n_key=f"factor.{factor_id}.name",
        description_i18n_key=f"factor.{factor_id}.description",
        category=category,
        factor_type="technical",
        required_fields=fields,
        default_params=params,
        parameter_schema=_parameter_schema(factor_id, params),
        direction_hint=direction,
        supported_contexts=("cta", "portfolio"),
        default_warmup_bars=_technical_warmup(factor_id, params),
        compute=compute,
    )


def _fundamental(
    factor_id: str,
    name: str,
    category: str,
    fields: tuple[str, ...],
    direction: str,
    compute: ComputeKernel,
    *,
    version: str = "1.0.0",
) -> FactorDefinition:
    """Fundamental factors take no parameters and no warm-up; their inputs are
    point-in-time columns (`market_cap`, `net_income`, ...) that the caller
    pushes in alongside the bars. AiChart has no fundamentals feed today, so
    in practice these return `factor.missingFields` until `web/` sources one —
    reported as absent, never substituted."""
    return FactorDefinition(
        factor_id=factor_id,
        version=version,
        name=name,
        name_i18n_key=f"factor.{factor_id}.name",
        description_i18n_key=f"factor.{factor_id}.description",
        category=category,
        factor_type="fundamental",
        required_fields=fields,
        default_params={},
        direction_hint=direction,
        supported_contexts=("portfolio",),
        compute=compute,
    )


_FACTORS: dict[str, FactorDefinition] = {
    definition.factor_id: definition
    for definition in (
        _technical(
            "sma", "Simple Moving Average", "trend",
            ("close",), {"period": 20},
            "neutral", lambda f, p: _sma(f, p),
        ),
        _technical(
            "ema", "Exponential Moving Average", "trend",
            ("close",), {"period": 20},
            "neutral", lambda f, p: _ema(f, p),
        ),
        _technical(
            "sma_distance", "Price Distance from SMA", "trend",
            ("close",), {"period": 20},
            "higher_is_bullish", lambda f, p: _ma_distance(f, p, exponential=False),
        ),
        _technical(
            "ema_distance", "Price Distance from EMA", "trend",
            ("close",), {"period": 20},
            "higher_is_bullish", lambda f, p: _ma_distance(f, p, exponential=True),
        ),
        _technical(
            "momentum", "Momentum", "momentum",
            ("close",), {"period": 60},
            "higher_is_bullish", lambda f, p: _return(f, p),
        ),
        _technical(
            "roc", "Rate of Change", "momentum",
            ("close",), {"period": 12},
            "higher_is_bullish", lambda f, p: _return(f, p),
        ),
        _technical(
            "rsi", "Relative Strength Index", "momentum",
            ("close",), {"period": 14},
            "neutral", lambda f, p: _rsi(f, p),
        ),
        _technical(
            "macd", "MACD", "trend",
            ("close",),
            {"fast_period": 12, "slow_period": 26, "signal_period": 9, "output": "histogram"},
            "higher_is_bullish", lambda f, p: _macd(f, p),
        ),
        _technical(
            "bollinger_bands", "Bollinger Bands", "volatility",
            ("close",), {"period": 20, "stddev": 2.0, "output": "position"},
            "neutral", lambda f, p: _bollinger(f, p),
        ),
        _technical(
            "stochastic", "Stochastic Oscillator", "momentum",
            ("high", "low", "close"), {"period": 14, "smooth_k": 3, "smooth_d": 3, "output": "k"},
            "neutral", lambda f, p: _stochastic(f, p),
        ),
        _technical(
            "kdj", "KDJ", "momentum",
            ("high", "low", "close"), {"period": 9, "k_period": 3, "d_period": 3, "output": "j"},
            "neutral", lambda f, p: _kdj(f, p),
        ),
        _technical(
            "cci", "Commodity Channel Index", "momentum",
            ("high", "low", "close"), {"period": 20},
            "neutral", lambda f, p: _cci(f, p),
        ),
        _technical(
            "williams_r", "Williams %R", "momentum",
            ("high", "low", "close"), {"period": 14},
            "neutral", lambda f, p: _williams_r(f, p),
        ),
        _technical(
            "mfi", "Money Flow Index", "volume",
            ("high", "low", "close", "volume"), {"period": 14},
            "neutral", lambda f, p: _mfi(f, p),
        ),
        _technical(
            "adx", "Average Directional Index", "trend",
            ("high", "low", "close"), {"period": 14, "output": "adx"},
            "neutral", lambda f, p: _adx(f, p),
        ),
        _technical(
            "aroon", "Aroon", "trend",
            ("high", "low"), {"period": 25, "output": "oscillator"},
            "higher_is_bullish", lambda f, p: _aroon(f, p),
        ),
        _technical(
            "trix", "TRIX", "trend",
            ("close",), {"period": 15},
            "higher_is_bullish", lambda f, p: _trix(f, p),
        ),
        _technical(
            "supertrend", "SuperTrend", "trend",
            ("high", "low", "close"), {"period": 10, "multiplier": 3.0, "output": "direction"},
            "higher_is_bullish", lambda f, p: _supertrend(f, p),
        ),
        _technical(
            "atr", "Average True Range", "volatility",
            ("high", "low", "close"), {"period": 14},
            "neutral", lambda f, p: _atr(f, p),
        ),
        _technical(
            "realized_volatility", "Realized Volatility", "risk",
            ("close",), {"period": 20},
            "lower_is_bullish", lambda f, p: _realized_vol(f, p),
        ),
        _technical(
            "ema_slope", "EMA Slope", "trend",
            ("close",), {"period": 20, "slope_period": 5},
            "higher_is_bullish", lambda f, p: _ema_slope(f, p),
        ),
        _technical(
            "atr_pct", "ATR Percentage", "risk",
            ("high", "low", "close"), {"period": 14},
            "lower_is_bullish", lambda f, p: _atr_pct(f, p),
        ),
        _technical(
            "downside_volatility", "Downside Volatility", "risk",
            ("close",), {"period": 20},
            "lower_is_bullish", lambda f, p: _downside_volatility(f, p),
        ),
        _technical(
            "max_drawdown", "Rolling Maximum Drawdown", "risk",
            ("close",), {"period": 60},
            "higher_is_bullish", lambda f, p: _max_drawdown(f, p),
        ),
        _technical(
            "donchian_channels", "Donchian Channels", "volatility",
            ("high", "low", "close"), {"period": 20, "output": "position"},
            "neutral", lambda f, p: _donchian(f, p),
        ),
        _technical(
            "keltner_channels", "Keltner Channels", "volatility",
            ("high", "low", "close"),
            {"period": 20, "atr_period": 10, "multiplier": 2.0, "output": "position"},
            "neutral", lambda f, p: _keltner(f, p),
        ),
        _technical(
            "volume_zscore", "Volume Z-Score", "liquidity",
            ("volume",), {"period": 20},
            "neutral", lambda f, p: _zscore_last(f.raw("volume"), p),
        ),
        _technical(
            "volume_ratio", "Volume Ratio", "liquidity",
            ("volume",), {"period": 20},
            "higher_is_bullish", lambda f, p: _volume_ratio(f, p),
        ),
        _technical(
            "mean_reversion_zscore", "Mean Reversion Z-Score", "reversal",
            ("close",), {"period": 20},
            "lower_is_bullish", lambda f, p: _zscore_last(f.raw("close"), p),
        ),
        _technical(
            "turnover_proxy", "Turnover Proxy", "liquidity",
            ("close", "volume"), {"period": 20},
            "higher_is_bullish", lambda f, p: _turnover(f, p),
        ),
        _technical(
            "obv", "On-Balance Volume", "volume",
            ("close", "volume"), {"period": 20, "output": "slope"},
            "higher_is_bullish", lambda f, p: _obv(f, p),
        ),
        _technical(
            "ad_line", "Accumulation/Distribution Line", "volume",
            ("high", "low", "close", "volume"), {"period": 20, "output": "slope"},
            "higher_is_bullish", lambda f, p: _ad_line(f, p),
        ),
        _technical(
            "chaikin_oscillator", "Chaikin Oscillator", "volume",
            ("high", "low", "close", "volume"), {"fast_period": 3, "slow_period": 10},
            "higher_is_bullish", lambda f, p: _chaikin(f, p),
        ),
        _technical(
            "vwap", "Volume-Weighted Average Price", "volume",
            ("high", "low", "close", "volume"), {"period": 20, "output": "distance"},
            "higher_is_bullish", lambda f, p: _vwap(f, p),
        ),
        _technical(
            "cmf", "Chaikin Money Flow", "volume",
            ("high", "low", "close", "volume"), {"period": 20},
            "higher_is_bullish", lambda f, p: _cmf(f, p),
        ),
        _technical(
            "dema", "Double Exponential Moving Average", "trend",
            ("close",), {"period": 20},
            "neutral", lambda f, p: _dema(f, p),
        ),
        _technical(
            "tema", "Triple Exponential Moving Average", "trend",
            ("close",), {"period": 20},
            "neutral", lambda f, p: _tema(f, p),
        ),
        _technical(
            "zlema", "Zero-Lag Exponential Moving Average", "trend",
            ("close",), {"period": 20},
            "neutral", lambda f, p: _zlema(f, p),
        ),
        _technical(
            "hma", "Hull Moving Average", "trend",
            ("close",), {"period": 20},
            "neutral", lambda f, p: _hma(f, p),
        ),
        _technical(
            "kama", "Kaufman Adaptive Moving Average", "trend",
            ("close",), {"period": 10, "fast_period": 2, "slow_period": 30},
            "neutral", lambda f, p: _kama(f, p),
        ),
        _technical(
            "ppo", "Percentage Price Oscillator", "momentum",
            ("close",), {"fast_period": 12, "slow_period": 26},
            "higher_is_bullish", lambda f, p: _ppo(f, p),
        ),
        _technical(
            "cmo", "Chande Momentum Oscillator", "momentum",
            ("close",), {"period": 14},
            "neutral", lambda f, p: _cmo(f, p),
        ),
        _technical(
            "awesome_oscillator", "Awesome Oscillator", "momentum",
            ("high", "low"), {"fast_period": 5, "slow_period": 34},
            "higher_is_bullish", lambda f, p: _awesome_oscillator(f, p),
        ),
        _technical(
            "ultimate_oscillator", "Ultimate Oscillator", "momentum",
            ("high", "low", "close"), {"fast_period": 7, "medium_period": 14, "slow_period": 28},
            "neutral", lambda f, p: _ultimate_oscillator(f, p),
        ),
        _technical(
            "tsi", "True Strength Index", "momentum",
            ("close",), {"slow_period": 25, "fast_period": 13},
            "neutral", lambda f, p: _tsi(f, p),
        ),
        _technical(
            "vortex", "Vortex Indicator", "trend",
            ("high", "low", "close"), {"period": 14, "output": "oscillator"},
            "higher_is_bullish", lambda f, p: _vortex(f, p),
        ),
        _technical(
            "choppiness", "Choppiness Index", "trend",
            ("high", "low", "close"), {"period": 14},
            "lower_is_bullish", lambda f, p: _choppiness(f, p),
        ),
        _technical(
            "efficiency_ratio", "Efficiency Ratio", "trend",
            ("close",), {"period": 10},
            "higher_is_bullish", lambda f, p: _efficiency_ratio(f, p),
        ),
        _technical(
            "elder_ray", "Elder Ray", "momentum",
            ("high", "low", "close"), {"period": 13, "output": "bull"},
            "neutral", lambda f, p: _elder_ray(f, p),
        ),
        _technical(
            "force_index", "Force Index", "volume",
            ("close", "volume"), {"period": 13},
            "higher_is_bullish", lambda f, p: _force_index(f, p),
        ),
        _technical(
            "ulcer_index", "Ulcer Index", "risk",
            ("close",), {"period": 14},
            "lower_is_bullish", lambda f, p: _ulcer_index(f, p),
        ),
        _technical(
            "parkinson_volatility", "Parkinson Volatility", "risk",
            ("high", "low"), {"period": 20},
            "lower_is_bullish", lambda f, p: _parkinson_volatility(f, p),
        ),
        _technical(
            "garman_klass_volatility", "Garman-Klass Volatility", "risk",
            ("open", "high", "low", "close"), {"period": 20},
            "lower_is_bullish", lambda f, p: _garman_klass_volatility(f, p),
        ),
        _technical(
            "amihud_illiquidity", "Amihud Illiquidity", "liquidity",
            ("close", "volume"), {"period": 20},
            "lower_is_bullish", lambda f, p: _amihud_illiquidity(f, p),
        ),
        _fundamental(
            "market_cap", "Market Capitalization", "size",
            ("market_cap",),
            "lower_is_bullish", lambda f, p: _last_value(f, "market_cap"),
        ),
        _fundamental(
            "earnings_yield", "Earnings Yield", "valuation",
            ("net_income", "market_cap"),
            "higher_is_bullish", lambda f, p: _ratio_last(f, "net_income", "market_cap"),
        ),
        _fundamental(
            "book_to_price", "Book-to-Price", "valuation",
            ("book_value", "market_cap"),
            "higher_is_bullish", lambda f, p: _ratio_last(f, "book_value", "market_cap"),
        ),
        _fundamental(
            "return_on_equity", "Return on Equity", "quality",
            ("net_income", "shareholder_equity"),
            "higher_is_bullish", lambda f, p: _ratio_last(f, "net_income", "shareholder_equity"),
        ),
        _fundamental(
            "revenue_growth", "Revenue Growth", "growth",
            ("revenue",),
            "higher_is_bullish", lambda f, p: _growth_last(f, "revenue"),
        ),
        _fundamental(
            "debt_to_equity", "Debt to Equity", "quality",
            ("total_debt", "shareholder_equity"),
            "lower_is_bullish", lambda f, p: _ratio_last(f, "total_debt", "shareholder_equity"),
        ),
        _fundamental(
            "free_cash_flow_yield", "Free Cash Flow Yield", "cashflow",
            ("free_cash_flow", "market_cap"),
            "higher_is_bullish", lambda f, p: _ratio_last(f, "free_cash_flow", "market_cap"),
        ),
    )
}


def list_factors(*, category: str = "", factor_type: str = "") -> list[dict[str, Any]]:
    """Filtered catalogue, sorted `(factor_type, category, factor_id)` — so the
    seven fundamental factors come first, exactly as upstream orders them."""
    values: list[dict[str, Any]] = []
    for definition in _FACTORS.values():
        if category and definition.category != category:
            continue
        if factor_type and definition.factor_type != factor_type:
            continue
        values.append(definition.metadata())
    return sorted(
        values, key=lambda item: (item["factor_type"], item["category"], item["factor_id"])
    )


def get_factor(factor_id: str) -> FactorDefinition:
    key = str(factor_id or "").strip()
    definition = _FACTORS.get(key)
    if definition is not None:
        return definition
    if key.lower().startswith(TALIB_PREFIX):
        raise FactorError("factor.talibUnavailable")
    raise FactorError("factor.notFound")


def compute_factor(
    factor_id: str, frame: Frame, params: Mapping[str, Any] | None = None
) -> float:
    """One factor, one frame, one float — the value at the LAST bar only.

    Upstream's contract to the digit: params are shallow-merged over the
    declared defaults, `FactorError` propagates untouched, any other exception
    collapses to `factor.computeFailed`, and a non-finite result becomes NaN
    rather than an error (a factor with no defined value for these bars is a
    valid answer — the caller reports it as absent).
    """
    definition = get_factor(factor_id)
    if frame.row_count <= 0:
        raise FactorError("factor.noData")
    missing = set(definition.required_fields) - set(frame.columns)
    if missing:
        raise FactorError("factor.missingFields")
    if definition.compute is None or definition.availability != "available":  # pragma: no cover
        raise FactorError("factor.computeFailed")
    merged: dict[str, Any] = {**definition.default_params, **dict(params or {})}
    try:
        value = float(definition.compute(frame, merged))
    except FactorError:
        raise
    except Exception as exc:
        raise FactorError("factor.computeFailed") from exc
    return value if math.isfinite(value) else NAN


def compute_panel_factor(
    factor_id: str, panel: Mapping[str, Frame], params: Mapping[str, Any] | None = None
) -> dict[str, float]:
    """Cross-sectional evaluation: one value per symbol, at each symbol's own
    last bar. Symbols with no data, missing fields or too little history are
    silently dropped (upstream's behaviour — a thin universe must not fail the
    whole rank), while a bad parameter still propagates."""
    output: dict[str, float] = {}
    for symbol, frame in panel.items():
        try:
            value = compute_factor(factor_id, frame, params)
        except FactorError as exc:
            if exc.code in {"factor.noData", "factor.missingFields", "factor.insufficientHistory"}:
                continue
            raise
        if math.isfinite(value):
            output[str(symbol)] = value
    return output


def factor_count() -> int:
    return len(_FACTORS)


def factor_ids() -> tuple[str, ...]:
    return tuple(_FACTORS)


def all_factors() -> tuple[FactorDefinition, ...]:
    return tuple(_FACTORS.values())
