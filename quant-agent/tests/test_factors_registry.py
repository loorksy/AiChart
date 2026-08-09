"""Shape of the catalogue: the exact factor count, the category histogram, and
the per-declaration invariants upstream's own registry test asserts."""

from __future__ import annotations

from collections import Counter

import pytest

from app.engine.factors.frame import FactorError
from app.engine.factors.registry import (
    _OUTPUT_OPTIONS,
    _technical_warmup,
    all_factors,
    factor_count,
    factor_ids,
    get_factor,
    list_factors,
)

# Verified against QuantDinger's `_FACTORS` table by parsing the declaration
# block: 54 technical + 7 fundamental.
EXPECTED_FACTOR_COUNT = 61
EXPECTED_TECHNICAL_COUNT = 54
EXPECTED_FUNDAMENTAL_COUNT = 7

EXPECTED_TECHNICAL_CATEGORIES = {
    "trend": 18,
    "momentum": 13,
    "volume": 7,
    "risk": 7,
    "volatility": 4,
    "liquidity": 4,
    "reversal": 1,
}
EXPECTED_FUNDAMENTAL_CATEGORIES = {
    "size": 1,
    "valuation": 2,
    "quality": 2,
    "growth": 1,
    "cashflow": 1,
}

VALID_DIRECTIONS = {"higher_is_bullish", "lower_is_bullish", "neutral"}
VALID_CONTEXTS = {"cta", "portfolio"}

# `default_warmup_bars` computed by executing upstream's `_technical_warmup`
# against each declared default-param dict; spot-frozen for the branches that
# are easy to get wrong.
EXPECTED_WARMUPS = {
    "momentum": 61,
    "rsi": 15,
    "macd": 35,
    "stochastic": 18,
    "trix": 46,
    "dema": 40,
    "tema": 60,
    "hma": 24,
    "kama": 11,
    "adx": 28,
    "ppo": 26,
    "awesome_oscillator": 34,
    "ultimate_oscillator": 29,
    "tsi": 39,
    "chaikin_oscillator": 10,
    "obv": 21,
    "ad_line": 21,
    "ema_slope": 25,
    "supertrend": 10,
    "kdj": 9,
}


def test_exact_factor_count() -> None:
    assert factor_count() == EXPECTED_FACTOR_COUNT
    assert len(factor_ids()) == EXPECTED_FACTOR_COUNT
    assert len(set(factor_ids())) == EXPECTED_FACTOR_COUNT


def test_category_histogram() -> None:
    technical = Counter(
        definition.category for definition in all_factors() if definition.factor_type == "technical"
    )
    fundamental = Counter(
        definition.category
        for definition in all_factors()
        if definition.factor_type == "fundamental"
    )
    assert dict(technical) == EXPECTED_TECHNICAL_CATEGORIES
    assert dict(fundamental) == EXPECTED_FUNDAMENTAL_CATEGORIES
    assert sum(technical.values()) == EXPECTED_TECHNICAL_COUNT
    assert sum(fundamental.values()) == EXPECTED_FUNDAMENTAL_COUNT


def test_every_factor_is_available_and_computable() -> None:
    """Nothing in the built-in registry needed TA-Lib or external data to
    reproduce, so nothing may be shipped as a silently-dropped stub."""
    for definition in all_factors():
        assert definition.availability == "available", definition.factor_id
        assert definition.unavailable_reason == ""
        assert definition.compute is not None


def test_declaration_invariants() -> None:
    for definition in all_factors():
        assert definition.factor_id
        assert definition.name
        assert definition.name_i18n_key == f"factor.{definition.factor_id}.name"
        assert (
            definition.description_i18n_key == f"factor.{definition.factor_id}.description"
        )
        assert definition.direction_hint in VALID_DIRECTIONS
        assert set(definition.supported_contexts) <= VALID_CONTEXTS
        assert definition.required_fields
        if definition.factor_type == "technical":
            # Enforced upstream too: a technical factor is always callable from
            # both the CTA and the portfolio runtime.
            assert definition.supported_contexts == ("cta", "portfolio")
        else:
            assert definition.supported_contexts == ("portfolio",)
            assert definition.default_params == {}
            assert definition.parameter_schema == {}
            assert definition.default_warmup_bars == 0


def test_parameter_schema_matches_defaults() -> None:
    for definition in all_factors():
        assert set(definition.parameter_schema) == set(definition.default_params)
        for key, entry in definition.parameter_schema.items():
            value = definition.default_params[key]
            if key == "output" and definition.factor_id in _OUTPUT_OPTIONS:
                assert entry == {
                    "type": "enum",
                    "options": list(_OUTPUT_OPTIONS[definition.factor_id]),
                }
                assert value in entry["options"]
            elif isinstance(value, bool):
                assert entry == {"type": "boolean"}
            elif isinstance(value, int):
                # Upstream advertises minimum 1 while `_period` rejects below 2.
                # Reproduced, not corrected — see the registry module docstring.
                assert entry == {"type": "integer", "minimum": 1, "maximum": 5000, "step": 1}
            elif isinstance(value, float):
                assert entry == {"type": "number", "minimum": 0.000001, "step": 0.1}


def test_every_output_option_owner_declares_an_output_param() -> None:
    for factor_id, options in _OUTPUT_OPTIONS.items():
        definition = get_factor(factor_id)
        assert definition.default_params["output"] in options


def test_warmup_estimates() -> None:
    warmups = {definition.factor_id: definition.default_warmup_bars for definition in all_factors()}
    for factor_id, expected in EXPECTED_WARMUPS.items():
        assert warmups[factor_id] == expected, factor_id
    # The generic fall-through: no special branch, so warm-up is the period.
    assert warmups["sma"] == 20
    assert warmups["max_drawdown"] == 60
    assert _technical_warmup("sma", {}) == 1


def test_list_factors_sort_order_and_filters() -> None:
    listed = list_factors()
    assert len(listed) == EXPECTED_FACTOR_COUNT
    keys = [(item["factor_type"], item["category"], item["factor_id"]) for item in listed]
    assert keys == sorted(keys)
    # Fundamental sorts before technical, exactly as upstream orders it.
    assert listed[0]["factor_type"] == "fundamental"

    assert len(list_factors(factor_type="technical")) == EXPECTED_TECHNICAL_COUNT
    assert len(list_factors(factor_type="fundamental")) == EXPECTED_FUNDAMENTAL_COUNT
    assert len(list_factors(category="reversal")) == 1
    assert list_factors(category="nope") == []
    assert len(list_factors(category="trend", factor_type="technical")) == 18


def test_metadata_is_json_ready() -> None:
    item = get_factor("macd").metadata()
    assert isinstance(item["required_fields"], list)
    assert isinstance(item["supported_contexts"], list)
    assert item["default_params"] == {
        "fast_period": 12,
        "slow_period": 26,
        "signal_period": 9,
        "output": "histogram",
    }
    assert item["version"] == "1.0.0"
    assert item["name"] == "MACD"


def test_get_factor_rejects_unknown_ids() -> None:
    with pytest.raises(FactorError) as excinfo:
        get_factor("does_not_exist")
    assert excinfo.value.code == "factor.notFound"

    with pytest.raises(FactorError) as excinfo:
        get_factor("")
    assert excinfo.value.code == "factor.notFound"

    # Whitespace is stripped, exactly as upstream strips it.
    assert get_factor("  rsi  ").factor_id == "rsi"


def test_talib_ids_report_the_missing_extension_not_a_missing_factor() -> None:
    """A client ported from QuantDinger may still ask for `talib:CDLDOJI`. It
    has to learn that TA-Lib is absent here, not that the factor never existed."""
    for factor_id in ("talib:CDLDOJI", "TALIB:RSI", "talib:HT_TRENDLINE"):
        with pytest.raises(FactorError) as excinfo:
            get_factor(factor_id)
        assert excinfo.value.code == "factor.talibUnavailable"
