"""NOT A TEST — the recipe that produced `test_factors_golden.json`.

It is named `test_factors_*` so it sits beside the fixture it generates and
inside the same review surface; pytest collects it, finds no test functions and
moves on. It is never imported by the suite, and `pandas` is imported inside
`main()` precisely so collecting this module costs nothing and needs nothing.

Run it against a checkout of QuantDinger, with an interpreter that has the
same pandas the upstream service pins (`pandas==3.0.5`):

    python -m venv /tmp/golden && /tmp/golden/bin/pip install 'pandas==3.0.5'
    /tmp/golden/bin/python tests/test_factors_golden_regen.py \\
        --upstream /path/to/quantdinger/backend_api_python

The point of the exercise is that the expected values come from UPSTREAM'S OWN
CODE, not from ours. Regenerating from this service's output would turn the
golden file from a proof of fidelity into a screenshot of whatever we currently
compute, so the loader in `test_factors_golden.py` asserts the provenance
header this script writes.

The synthetic series live here rather than in the test module for the same
reason: one definition, consumed by upstream at generation time and by us at
assertion time, with no chance of the two drifting apart.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

DEFAULT_UPSTREAM = Path("/workspace/openbyteinc/quantdinger/backend_api_python")
REGISTRY_RELATIVE = Path("app/services/factors/registry.py")
OUTPUT = Path(__file__).with_name("test_factors_golden.json")

START = datetime(2026, 1, 1, tzinfo=UTC)


def lcg(state: int) -> int:
    return (state * 1103515245 + 12345) & 0x7FFFFFFF


def stamp(index: int) -> str:
    return (START + timedelta(hours=index)).isoformat()


def primary_series(count: int = 300) -> list[dict[str, Any]]:
    """Trending, noisy, volume-varying. Everything is generated in integer
    cents so the JSON round-trips bit for bit."""
    state = 20260809
    close = 100_000
    out: list[dict[str, Any]] = []
    for index in range(count):
        open_cents = close
        state = lcg(state)
        drift = 4 if (index // 37) % 2 == 0 else -3
        close = max(1_000, open_cents + (state % 401) - 200 + drift)
        state = lcg(state)
        high = max(open_cents, close) + state % 130
        state = lcg(state)
        low = max(1, min(open_cents, close) - state % 130)
        state = lcg(state)
        volume = 1_000 + state % 9_000
        out.append(
            {
                "time": stamp(index),
                "open": open_cents / 100.0,
                "high": high / 100.0,
                "low": low / 100.0,
                "close": close / 100.0,
                "volume": float(volume),
            }
        )
    return out


def flat_series(count: int = 40) -> list[dict[str, Any]]:
    """Every bar identical: exercises every degenerate-range branch at once
    (williams_r -50, donchian/keltner/bollinger position 0.5, choppiness 100,
    cci 0, kdj's rsv=50 fallback, vortex's zero-TR early return)."""
    return [
        {
            "time": stamp(index),
            "open": 500.0,
            "high": 500.0,
            "low": 500.0,
            "close": 500.0,
            "volume": 250.0,
        }
        for index in range(count)
    ]


def zero_volume_series(count: int = 60) -> list[dict[str, Any]]:
    """One untraded bar inside the amihud window: the NaN has to poison that
    factor, and must NOT poison the ones that skip NaN."""
    out = primary_series(count)
    out[-5]["volume"] = 0.0
    return out


def short_series(count: int = 5) -> list[dict[str, Any]]:
    """Five bars, so `atr` with period 3 is dominated by the seed mean — which
    includes bar 0's `high - low`. That is the bar-0 true-range quirk."""
    state = 777
    close = 20_000
    out: list[dict[str, Any]] = []
    for index in range(count):
        open_cents = close
        state = lcg(state)
        close = open_cents + (state % 201) - 100
        state = lcg(state)
        high = max(open_cents, close) + state % 60
        state = lcg(state)
        low = min(open_cents, close) - state % 60
        state = lcg(state)
        out.append(
            {
                "time": stamp(index),
                "open": open_cents / 100.0,
                "high": high / 100.0,
                "low": low / 100.0,
                "close": close / 100.0,
                "volume": float(500 + state % 500),
            }
        )
    return out


def fundamental_rows() -> list[dict[str, float]]:
    """Eight point-in-time reporting periods."""
    return [
        {
            "market_cap": 1.0e9 + index * 3.7e7,
            "net_income": 4.25e7 + index * 1.1e6,
            "book_value": 3.1e8 - index * 2.0e6,
            "shareholder_equity": 5.6e8 + index * 4.0e6,
            "revenue": 2.4e8 + index * 9.5e6,
            "total_debt": 1.85e8 - index * 1.5e6,
            "free_cash_flow": 3.05e7 + index * 8.0e5,
        }
        for index in range(8)
    ]


def build_series() -> dict[str, dict[str, Any]]:
    return {
        "primary": {"bars": primary_series(), "fundamentals": []},
        "flat": {"bars": flat_series(), "fundamentals": []},
        "zero_volume": {"bars": zero_volume_series(), "fundamentals": []},
        "short": {"bars": short_series(), "fundamentals": []},
        "fundamentals": {"bars": [], "fundamentals": fundamental_rows()},
    }


ALTERNATE_OUTPUTS: dict[str, list[str]] = {
    "ad_line": ["value"],
    "adx": ["plus_di", "minus_di"],
    "aroon": ["up", "down"],
    "bollinger_bands": ["upper", "middle", "lower", "bandwidth"],
    "donchian_channels": ["upper", "middle", "lower"],
    "elder_ray": ["bear"],
    "kdj": ["k", "d"],
    "keltner_channels": ["upper", "middle", "lower"],
    "macd": ["line", "signal"],
    "obv": ["value"],
    "stochastic": ["d"],
    "supertrend": ["line"],
    "vwap": ["value"],
    "vortex": ["plus", "minus"],
}

FUNDAMENTAL_IDS = frozenset(
    {
        "market_cap",
        "earnings_yield",
        "book_to_price",
        "return_on_equity",
        "revenue_growth",
        "debt_to_equity",
        "free_cash_flow_yield",
    }
)

# Named probes on top of the default sweep, one per documented subtlety plus
# the guard branches and the trickier non-default periods.
SUBTLETY_CASES: list[tuple[str, str, str, dict[str, Any]]] = [
    ("bar0_true_range", "short", "atr", {"period": 3}),
    ("bar0_true_range_pct", "short", "atr_pct", {"period": 3}),
    ("ddof_population", "primary", "bollinger_bands", {"period": 5, "output": "upper"}),
    ("ddof_sample", "primary", "mean_reversion_zscore", {"period": 5}),
    ("ddof_sample_volume", "primary", "volume_zscore", {"period": 5}),
    ("ddof_sample_realized", "primary", "realized_volatility", {"period": 5}),
    ("adx_loop_short", "primary", "adx", {"period": 2, "output": "adx"}),
    ("adx_loop_plus", "primary", "adx", {"period": 2, "output": "plus_di"}),
    ("adx_loop_minus", "primary", "adx", {"period": 2, "output": "minus_di"}),
    ("kdj_seed_one_step", "short", "kdj", {"period": 5, "output": "k"}),
    ("kdj_seed_one_step_d", "short", "kdj", {"period": 5, "output": "d"}),
    ("kdj_seed_one_step_j", "short", "kdj", {"period": 5, "output": "j"}),
    ("kdj_flat_rsv_fallback", "flat", "kdj", {"period": 9, "output": "j"}),
    ("amihud_nan_poison", "zero_volume", "amihud_illiquidity", {"period": 20}),
    ("cmf_survives_zero_volume", "zero_volume", "cmf", {"period": 20}),
    ("obv_survives_zero_volume", "zero_volume", "obv", {"period": 20}),
    ("ema_seed_equals_sma", "short", "ema", {"period": 5}),
    ("sma_same_window", "short", "sma", {"period": 5}),
    ("ema_seed_plus_one", "short", "ema", {"period": 4}),
    ("flat_williams", "flat", "williams_r", {"period": 14}),
    ("flat_donchian", "flat", "donchian_channels", {"period": 20}),
    ("flat_bollinger", "flat", "bollinger_bands", {"period": 20}),
    ("flat_choppiness", "flat", "choppiness", {"period": 14}),
    ("flat_cci", "flat", "cci", {"period": 20}),
    ("flat_vortex", "flat", "vortex", {"period": 14}),
    ("flat_atr", "flat", "atr", {"period": 14}),
    ("flat_rsi", "flat", "rsi", {"period": 14}),
    ("flat_stochastic", "flat", "stochastic", {"period": 14}),
    ("flat_efficiency", "flat", "efficiency_ratio", {"period": 10}),
    ("flat_supertrend", "flat", "supertrend", {"period": 10}),
    ("period_below_minimum", "primary", "sma", {"period": 1}),
    ("period_above_maximum", "primary", "sma", {"period": 5001}),
    ("period_falsy_falls_back", "primary", "sma", {"period": 0}),
    ("history_too_short", "short", "sma", {"period": 20}),
    ("macd_fast_not_below_slow", "primary", "macd", {"fast_period": 26, "slow_period": 12}),
    ("bad_output_option", "primary", "adx", {"output": "nope"}),
    ("uo_ordering_enforced", "primary", "ultimate_oscillator", {"medium_period": 30}),
    ("bollinger_bad_stddev", "primary", "bollinger_bands", {"stddev": 0}),
    ("missing_fundamental_column", "primary", "market_cap", {}),
    ("hma_odd_period", "primary", "hma", {"period": 17}),
    ("kama_tight", "primary", "kama", {"period": 4, "fast_period": 1, "slow_period": 9}),
    ("zlema_even_lag", "primary", "zlema", {"period": 11}),
    ("trix_short", "primary", "trix", {"period": 5}),
    ("supertrend_line", "primary", "supertrend", {"period": 7, "output": "line"}),
    ("stochastic_smoothing", "primary", "stochastic", {"smooth_k": 1, "smooth_d": 1}),
    ("keltner_wide", "primary", "keltner_channels", {"period": 30, "atr_period": 5}),
    ("vwap_value", "primary", "vwap", {"period": 50, "output": "value"}),
    ("tsi_short", "primary", "tsi", {"slow_period": 7, "fast_period": 3}),
    ("ao_wide", "primary", "awesome_oscillator", {"fast_period": 3, "slow_period": 60}),
    ("chaikin_wide", "primary", "chaikin_oscillator", {"fast_period": 5, "slow_period": 40}),
]


def main() -> int:
    import numpy as np
    import pandas as pd

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, default=DEFAULT_UPSTREAM)
    parser.add_argument("--out", type=Path, default=OUTPUT)
    arguments = parser.parse_args()

    registry_path = arguments.upstream / REGISTRY_RELATIVE
    if not registry_path.is_file():
        print(f"upstream registry not found at {registry_path}", file=sys.stderr)
        return 2

    spec = importlib.util.spec_from_file_location("qd_registry", registry_path)
    assert spec is not None and spec.loader is not None
    upstream = importlib.util.module_from_spec(spec)
    sys.modules["qd_registry"] = upstream
    spec.loader.exec_module(upstream)

    series = build_series()

    def frame_for(key: str) -> Any:
        entry = series[key]
        if entry["bars"]:
            return pd.DataFrame(
                [
                    {field: row[field] for field in ("open", "high", "low", "close", "volume")}
                    for row in entry["bars"]
                ]
            )
        return pd.DataFrame(entry["fundamentals"])

    def evaluate(key: str, factor_id: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            value = upstream.compute_factor(factor_id, frame_for(key), params)
        except upstream.FactorError as exc:
            return {"error": exc.code, "value": None, "is_nan": False}
        if not math.isfinite(value):
            return {"error": None, "value": None, "is_nan": True}
        return {"error": None, "value": float(value), "is_nan": False}

    cases: list[dict[str, Any]] = []
    for definition in upstream.list_factors():
        factor_id = definition["factor_id"]
        key = "fundamentals" if factor_id in FUNDAMENTAL_IDS else "primary"
        cases.append(
            {
                "name": f"{factor_id}:default",
                "series": key,
                "factor_id": factor_id,
                "params": {},
                **evaluate(key, factor_id, {}),
            }
        )
        for output in ALTERNATE_OUTPUTS.get(factor_id, []):
            params = {"output": output}
            cases.append(
                {
                    "name": f"{factor_id}:{output}",
                    "series": key,
                    "factor_id": factor_id,
                    "params": params,
                    **evaluate(key, factor_id, params),
                }
            )
    for name, key, factor_id, params in SUBTLETY_CASES:
        cases.append(
            {
                "name": name,
                "series": key,
                "factor_id": factor_id,
                "params": params,
                **evaluate(key, factor_id, params),
            }
        )

    payload = {
        "meta": {
            "purpose": (
                "Frozen output of QuantDinger's own factor registry over fixed synthetic "
                "series. Regenerate ONLY with tests/test_factors_golden_regen.py against "
                "the upstream implementation; never by copying this service's own output."
            ),
            "upstream": (
                "https://github.com/OpenByteInc/QuantDinger "
                "backend_api_python/app/services/factors/registry.py (Apache-2.0)"
            ),
            "generated_with": {
                "python": sys.version.split()[0],
                "pandas": pd.__version__,
                "numpy": np.__version__,
            },
            "builtin_count": len(upstream.list_factors()),
            "case_count": len(cases),
        },
        "series": series,
        "cases": cases,
    }
    with arguments.out.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, allow_nan=False)
        handle.write("\n")

    errors = [case for case in cases if case["error"]]
    nans = [case for case in cases if case["is_nan"]]
    print(f"wrote {arguments.out} cases={len(cases)} errors={len(errors)} nan={len(nans)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
