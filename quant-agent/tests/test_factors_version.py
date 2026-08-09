"""Frozen `(factor_id, version, fingerprint)` table.

Upstream hard-codes `version = "1.0.0"` on all 61 factors and has no bump
mechanism, so a formula edit there changes every stored research result with no
signal. This is the CI guard that closes that gap here.

The fingerprint covers the factor's declared defaults and required fields plus
the normalized source of its kernel and every helper that kernel transitively
calls, across `compute.py` and `frame.py`. Comments, docstrings and line
layout do not count; anything that changes the token stream does.

**If this test fails**, the formula moved. That is a semantic change to a
number other people's saved analyses were computed from, so:

  1. Bump the factor's `version` in `app/engine/factors/registry.py`
     (patch for a bug fix, minor for a changed definition).
  2. Regenerate `tests/test_factors_golden.json` by running the UPSTREAM
     implementation again — never by copying this service's output.
  3. Update the row below with the new version and fingerprint.

Do not "fix" a failure by pasting the new fingerprint alone: that is the one
move this test exists to prevent.
"""

from __future__ import annotations

from collections.abc import Callable
from types import FunctionType

from app.engine.factors import compute as compute_module
from app.engine.factors.fingerprint import (
    _closure,
    _normalized_source,
    formula_fingerprint,
)
from app.engine.factors.registry import all_factors, get_factor

FROZEN: dict[str, tuple[str, str]] = {
    "sma": ("1.0.0", "f62c5abd371755e7"),
    "ema": ("1.0.0", "20d4b4e3832e9e06"),
    "sma_distance": ("1.0.0", "a520e61fb93f55a0"),
    "ema_distance": ("1.0.0", "3b21b2619eb1f9a4"),
    "momentum": ("1.0.0", "db629db490a5d755"),
    "roc": ("1.0.0", "af257d0cd9022e83"),
    "rsi": ("1.0.0", "31ddd68b9fd3d555"),
    "macd": ("1.0.0", "a690b96e2db98502"),
    "bollinger_bands": ("1.0.0", "aa151cffd3edfc2e"),
    "stochastic": ("1.0.0", "5e39b3d11ea3629d"),
    "kdj": ("1.0.0", "fbe55a9086e5d52a"),
    "cci": ("1.0.0", "e20955cee041f6d9"),
    "williams_r": ("1.0.0", "7740d6fb24b5ed8e"),
    "mfi": ("1.0.0", "b5a01deac093da9c"),
    "adx": ("1.0.0", "f4baf4faf909f476"),
    "aroon": ("1.0.0", "af03215bb8b16379"),
    "trix": ("1.0.0", "f94ae456947765b4"),
    "supertrend": ("1.0.0", "7394f952f70c5feb"),
    "atr": ("1.0.0", "e625873689111b3d"),
    "realized_volatility": ("1.0.0", "16128135d0ade073"),
    "ema_slope": ("1.0.0", "fc254a18155a46fa"),
    "atr_pct": ("1.0.0", "b1444809b72e89ce"),
    "downside_volatility": ("1.0.0", "2874648d97f22e93"),
    "max_drawdown": ("1.0.0", "aab3c438d3121a74"),
    "donchian_channels": ("1.0.0", "2de700128250c149"),
    "keltner_channels": ("1.0.0", "50f12128809fdb68"),
    "volume_zscore": ("1.0.0", "68aa13cfd63d4d33"),
    "volume_ratio": ("1.0.0", "e24543bb4eb3157f"),
    "mean_reversion_zscore": ("1.0.0", "167450223eae4ec8"),
    "turnover_proxy": ("1.0.0", "b19f1ea03fc7be2c"),
    "obv": ("1.0.0", "c9a817cf8c893f54"),
    "ad_line": ("1.0.0", "1087afbf2568c42a"),
    "chaikin_oscillator": ("1.0.0", "273f76ec2a84c2d3"),
    "vwap": ("1.0.0", "a53db282cb62ca16"),
    "cmf": ("1.0.0", "32202cfa61d9e048"),
    "dema": ("1.0.0", "fdf2cf6af70277e9"),
    "tema": ("1.0.0", "1d0e58b8351e84ef"),
    "zlema": ("1.0.0", "2a8d6d1467ee042a"),
    "hma": ("1.0.0", "ad37228640d23626"),
    "kama": ("1.0.0", "f00b932f5d2f8492"),
    "ppo": ("1.0.0", "e660338a9d872b4b"),
    "cmo": ("1.0.0", "30b49fec16deebc7"),
    "awesome_oscillator": ("1.0.0", "f41e87682c7063ef"),
    "ultimate_oscillator": ("1.0.0", "511dd7cfd73fce55"),
    "tsi": ("1.0.0", "4921eb372a63fa5a"),
    "vortex": ("1.0.0", "6d1677067a3c58be"),
    "choppiness": ("1.0.0", "3182411654d2957f"),
    "efficiency_ratio": ("1.0.0", "19fbde5a9c2477ed"),
    "elder_ray": ("1.0.0", "594d98d6149d6651"),
    "force_index": ("1.0.0", "8475beb5b660b28b"),
    "ulcer_index": ("1.0.0", "cff965a6285b9f4e"),
    "parkinson_volatility": ("1.0.0", "92bd06ee08be2caa"),
    "garman_klass_volatility": ("1.0.0", "0fa1c020802fefae"),
    "amihud_illiquidity": ("1.0.0", "8ecba3822fe7adfa"),
    "market_cap": ("1.0.0", "8f51e86e57a98dc7"),
    "earnings_yield": ("1.0.0", "12efd24241cf58f9"),
    "book_to_price": ("1.0.0", "95b1741f254e90c9"),
    "return_on_equity": ("1.0.0", "5fe9d0eb1065e034"),
    "revenue_growth": ("1.0.0", "37dfd14aa50106a3"),
    "debt_to_equity": ("1.0.0", "3c7e949ae9ab5bc4"),
    "free_cash_flow_yield": ("1.0.0", "65fd63426cad7899"),
}


def current_fingerprint(factor_id: str) -> str:
    definition = get_factor(factor_id)
    assert definition.compute is not None
    return formula_fingerprint(
        definition.factor_id,
        definition.compute,
        default_params=definition.default_params,
        required_fields=definition.required_fields,
    )


def test_the_frozen_table_lists_every_factor() -> None:
    assert set(FROZEN) == {definition.factor_id for definition in all_factors()}


def test_versions_and_formulas_are_frozen() -> None:
    drifted: list[str] = []
    for definition in all_factors():
        expected_version, expected_fingerprint = FROZEN[definition.factor_id]
        actual = current_fingerprint(definition.factor_id)
        if definition.version != expected_version or actual != expected_fingerprint:
            drifted.append(
                f"{definition.factor_id}: frozen=({expected_version}, {expected_fingerprint}) "
                f"actual=({definition.version}, {actual})"
            )
    assert not drifted, (
        "A factor formula changed. Bump its version, regenerate the golden file "
        "from UPSTREAM, then update tests/test_factors_version.py:\n  "
        + "\n  ".join(drifted)
    )


def test_versions_are_semver_triples() -> None:
    for definition in all_factors():
        parts = definition.version.split(".")
        assert len(parts) == 3, definition.factor_id
        assert all(part.isdigit() for part in parts), definition.factor_id


def test_fingerprints_are_unique_per_factor() -> None:
    """Two factors that share a kernel must still be distinguishable, or a
    change to one would be blamed on the other."""
    fingerprints = {
        definition.factor_id: current_fingerprint(definition.factor_id)
        for definition in all_factors()
    }
    assert len(set(fingerprints.values())) == len(fingerprints)
    # `momentum` and `roc` are the same kernel with different default periods.
    assert fingerprints["momentum"] != fingerprints["roc"]
    # `sma_distance` and `ema_distance` differ only by a keyword argument
    # baked into the dispatch lambda.
    assert fingerprints["sma_distance"] != fingerprints["ema_distance"]


def test_fingerprints_are_stable_across_calls() -> None:
    assert current_fingerprint("rsi") == current_fingerprint("rsi")


def test_closure_reaches_shared_helpers_in_both_modules() -> None:
    definition = get_factor("ema")
    assert definition.compute is not None
    reached = _closure(definition.compute)
    assert "_ema" in reached
    assert "_ema_values" in reached  # compute.py
    assert "nan_filter" in reached  # frame.py
    assert "_kdj" not in reached  # an unrelated kernel must not be dragged in


def test_editing_a_shared_helper_moves_the_dependent_factors() -> None:
    """The guard has to actually fire. Swapping `_ema_values` for a differently
    written implementation must change every EMA-derived fingerprint and leave
    `sma`'s alone."""

    def replacement(values: list[float], period: int) -> list[float]:
        raise NotImplementedError("a deliberately different body")

    # `_resolve` only follows functions that claim to live in our modules.
    replacement.__module__ = compute_module.__name__
    before_ema = current_fingerprint("ema")
    before_sma = current_fingerprint("sma")

    original = compute_module._ema_values
    compute_module._ema_values = replacement  # type: ignore[assignment]
    try:
        assert current_fingerprint("ema") != before_ema
        assert current_fingerprint("sma") == before_sma
    finally:
        compute_module._ema_values = original  # type: ignore[assignment]

    assert current_fingerprint("ema") == before_ema


def test_comments_docstrings_and_layout_do_not_count() -> None:
    """Documenting a kernel must be free; changing one must not be."""

    def build_plain() -> Callable[[float], float]:
        def kernel(value: float) -> float:
            return max(value * 2.0, 1.0)

        return kernel

    def build_documented() -> Callable[[float], float]:
        def kernel(value: float) -> float:
            """A docstring the fingerprint must ignore."""
            # A comment the fingerprint must ignore.
            return max(
                value * 2.0,
                1.0)

        return kernel

    def build_changed() -> Callable[[float], float]:
        def kernel(value: float) -> float:
            return max(value * 3.0, 1.0)

        return kernel

    assert _normalized_source(build_plain()) == _normalized_source(build_documented())
    assert _normalized_source(build_plain()) != _normalized_source(build_changed())


def test_normalized_source_handles_a_real_kernel() -> None:
    kernel = compute_module._rsi
    assert isinstance(kernel, FunctionType)
    normalized = _normalized_source(kernel)
    assert "avg_gain" in normalized
    # The docstring-free `_rsi` has no prose to strip, but the helper it leans
    # on does, and that prose must not be part of the hash input.
    assert "The system-wide EMA convention" not in _normalized_source(
        compute_module._ema_values
    )
