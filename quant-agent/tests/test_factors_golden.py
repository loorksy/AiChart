"""The proof of fidelity: every factor's value, frozen from UPSTREAM's output.

`test_factors_golden.json` was produced by running QuantDinger's own
`backend_api_python/app/services/factors/registry.py` (pandas 3.0.5, numpy
2.4.6) over the fixed synthetic series stored in the same file. This module
replays those series through this service's pure-Python port and asserts the
numbers still line up. Without this file the port is unverified — a plausible
reimplementation, not a port.

Regenerating it means re-running the UPSTREAM implementation, never copying
this service's own output; the header inside the JSON says so too.

Tolerance: `GOLDEN_TOLERANCE` is a RELATIVE bound, which is the meaningful way
to say "eight decimal places" across a table whose values span 1e-3 (a return)
to 1e+9 (a market cap). 122 of the 127 numeric cases are BIT-EXACT against
upstream; the five that are not (`hma`, `vwap` with `output=value`,
`stochastic` with `output=d`, `turnover_proxy`) differ by at most 2.4e-16
relative — one ULP, because pandas sums a window pairwise while the stdlib
sums it sequentially. The bound below is four orders of magnitude looser than
that worst case and still far tighter than eight decimal places everywhere.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.engine.factors.frame import FactorError, Frame
from app.engine.factors.models import build_frame
from app.engine.factors.registry import compute_factor, factor_ids, get_factor
from app.storage.models import Bar

GOLDEN_PATH = Path(__file__).with_name("test_factors_golden.json")
GOLDEN: dict[str, Any] = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))

GOLDEN_TOLERANCE = 1e-12


def _frame(series_key: str) -> Frame:
    series = GOLDEN["series"][series_key]
    bars = [Bar.model_validate(row) for row in series["bars"]]
    return build_frame(bars, series["fundamentals"])


FRAMES: dict[str, Frame] = {key: _frame(key) for key in GOLDEN["series"]}
CASES: list[dict[str, Any]] = GOLDEN["cases"]


def test_golden_file_covers_every_factor() -> None:
    """A factor with no frozen value is a factor nobody has verified."""
    covered = {case["factor_id"] for case in CASES}
    assert covered == set(factor_ids())
    assert GOLDEN["meta"]["builtin_count"] == len(factor_ids())


def test_golden_file_is_upstream_output() -> None:
    """Guards against someone "fixing" a failure by regenerating from us."""
    assert "QuantDinger" in GOLDEN["meta"]["upstream"]
    assert GOLDEN["meta"]["generated_with"]["pandas"].startswith("3.")
    assert GOLDEN["meta"]["case_count"] == len(CASES)
    assert len(GOLDEN["series"]["primary"]["bars"]) == 300


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_factor_matches_upstream(case: dict[str, Any]) -> None:
    frame = FRAMES[case["series"]]
    if case["error"]:
        with pytest.raises(FactorError) as excinfo:
            compute_factor(case["factor_id"], frame, case["params"])
        assert excinfo.value.code == case["error"]
        return

    value = compute_factor(case["factor_id"], frame, case["params"])
    if case["is_nan"]:
        # NaN is an answer, not a failure: this factor has no defined value for
        # these bars, and the caller must report it as absent.
        assert value != value
        return
    assert value == pytest.approx(
        case["value"], rel=GOLDEN_TOLERANCE, abs=GOLDEN_TOLERANCE
    )


def test_declared_versions_are_reachable_from_every_case() -> None:
    for case in CASES:
        assert get_factor(case["factor_id"]).version
