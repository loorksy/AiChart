"""The pushed-in bar table plus pure-stdlib stand-ins for the pandas/numpy
idioms QuantDinger's factor registry is written in.

Derived from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/factors/registry.py`.

Changed on port: upstream computes on a `pandas.DataFrame` and leans on numpy
for reductions. This service has no pandas and no numpy (see
`quant-agent/pyproject.toml` and `app/sandbox/safe_exec.py`), so every idiom
had to be re-expressed in the stdlib. The re-expression is only faithful if it
reproduces pandas' semantics rather than the "obvious" Python ones, and the
four places where those differ are the reason this module exists:

  * `Series.sum()` / `.mean()` / `.max()` / `.min()` SKIP NaN; an all-NaN sum
    is `0.0` while an all-NaN mean is NaN. `Series.rolling(n).mean()` does the
    opposite and PROPAGATES a NaN anywhere in the window. Both spellings are
    used by the kernels, so both are provided (`nansum`/`nanmean` vs
    `rolling_mean`).
  * numpy division never raises: `1/0` is `inf`, `0/0` is NaN. Python raises
    `ZeroDivisionError`, which upstream would have surfaced as a value, not an
    error — hence `divide()`.
  * `numpy.log` returns NaN for a negative argument and `-inf` for zero;
    `math.log` raises. Hence `log()`.
  * `numpy.argmax`/`argmin` return the index of the FIRST NaN when one is
    present, because NaN compares as both the largest and the smallest.

Column values are stored already coerced the way `pd.to_numeric(errors=
"coerce")` would leave them: anything non-numeric is NaN. Note that this is
NOT the same as upstream's `_numeric()` helper, which additionally maps
±inf to NaN and drops every NaN row; that one lives in `compute.py` next to
the kernels that call it, exactly as upstream has it.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

NAN = float("nan")
INF = float("inf")


class FactorError(ValueError):
    """Upstream's error type: one machine-readable code, no prose.

    The code strings are part of the ported contract (`factor.notFound`,
    `factor.noData`, `factor.missingFields`, `factor.insufficientHistory`,
    `factor.invalidParameter`, `factor.computeFailed`) and are surfaced
    verbatim by `app/api/factors.py` so a client can key i18n off them.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Frame:
    """One symbol's table of named float columns — the `pd.DataFrame` stand-in.

    `row_count` is deliberately separate from the column lengths: several
    kernels guard on `len(frame)` (the raw row count) while computing over a
    NaN-dropped column, and conflating the two changes which inputs raise
    `factor.insufficientHistory`.
    """

    columns: Mapping[str, tuple[float, ...]]
    row_count: int

    def has(self, name: str) -> bool:
        return name in self.columns

    def raw(self, name: str) -> tuple[float, ...]:
        """The column as `pd.to_numeric(frame[name], errors="coerce")` leaves
        it: full length, NaN where the value was missing or non-numeric."""
        try:
            return self.columns[name]
        except KeyError as exc:  # pragma: no cover - guarded by required_fields
            raise FactorError("factor.missingFields") from exc

    def product(self, left: str, right: str) -> list[float]:
        """`frame[left] * frame[right]`, element-wise, NaN-propagating."""
        return [a * b for a, b in zip(self.raw(left), self.raw(right), strict=True)]


def divide(numerator: float, denominator: float) -> float:
    """`numpy.true_divide` semantics: never raises, `0/0` is NaN, `x/0` is
    signed infinity. Python's `/` raises `ZeroDivisionError` instead, which
    would turn an upstream value into a `factor.computeFailed`."""
    if denominator == 0.0:
        if numerator == 0.0 or math.isnan(numerator):
            return NAN
        return math.copysign(INF, numerator) * math.copysign(1.0, denominator)
    return numerator / denominator


def log(value: float) -> float:
    """`numpy.log` semantics: NaN for a negative argument, `-inf` at zero."""
    if math.isnan(value):
        return NAN
    if value < 0.0:
        return NAN
    if value == 0.0:
        return -INF
    return math.log(value)


def sqrt(value: float) -> float:
    """`numpy.sqrt` semantics: NaN for a negative argument."""
    if math.isnan(value) or value < 0.0:
        return NAN
    return math.sqrt(value)


def nan_filter(values: Sequence[float]) -> list[float]:
    """Upstream `_numeric`: coerce, map ±inf to NaN, then drop every NaN."""
    return [value for value in values if math.isfinite(value)]


def dropna(values: Sequence[float]) -> list[float]:
    """`Series.dropna()`: drops NaN only. ±inf survives, as it does upstream."""
    return [value for value in values if not math.isnan(value)]


def nansum(values: Sequence[float]) -> float:
    """`Series.sum()`: skips NaN; an empty or all-NaN series sums to `0.0`."""
    return sum(value for value in values if not math.isnan(value))


def nanmean(values: Sequence[float]) -> float:
    """`Series.mean()`: skips NaN; an empty or all-NaN series is NaN."""
    present = [value for value in values if not math.isnan(value)]
    if not present:
        return NAN
    return sum(present) / len(present)


def nanmax(values: Sequence[float]) -> float:
    """`Series.max()`: skips NaN; an empty or all-NaN series is NaN."""
    present = [value for value in values if not math.isnan(value)]
    return max(present) if present else NAN


def nanmin(values: Sequence[float]) -> float:
    """`Series.min()`: skips NaN; an empty or all-NaN series is NaN."""
    present = [value for value in values if not math.isnan(value)]
    return min(present) if present else NAN


def mean(values: Sequence[float]) -> float:
    """`numpy.mean` on a raw array: NaN poisons the whole result.

    Only `_amihud_illiquidity` needs this — it drops to `.to_numpy()` before
    averaging, which is precisely why one untraded bar makes that factor NaN.
    """
    if not values:
        return NAN
    return sum(values) / len(values)


def stdev(values: Sequence[float], ddof: int) -> float:
    """`Series.std(ddof=...)`.

    `ddof` is load-bearing and differs per factor: `bollinger_bands` uses the
    POPULATION deviation (`ddof=0`) while `realized_volatility`,
    `volume_zscore` and `mean_reversion_zscore` use the SAMPLE one
    (`ddof=1`). Same two-pass algorithm pandas uses, so the rounding matches.
    """
    count = len(values)
    if count - ddof <= 0:
        return NAN
    average = sum(values) / count
    total = sum((value - average) ** 2 for value in values)
    return sqrt(total / (count - ddof))


def cummax(values: Sequence[float]) -> list[float]:
    """`Series.cummax()`."""
    out: list[float] = []
    running = -INF
    for value in values:
        if math.isnan(value):
            out.append(NAN)
            continue
        running = max(running, value)
        out.append(running)
    return out


def cumsum(values: Sequence[float]) -> list[float]:
    """`Series.cumsum()`: NaN entries stay NaN but do not poison the total."""
    out: list[float] = []
    running = 0.0
    for value in values:
        if math.isnan(value):
            out.append(NAN)
            continue
        running += value
        out.append(running)
    return out


def diff(values: Sequence[float]) -> list[float]:
    """`Series.diff()`: NaN in the first slot."""
    if not values:
        return []
    return [NAN] + [values[index] - values[index - 1] for index in range(1, len(values))]


def pct_change(values: Sequence[float]) -> list[float]:
    """`Series.pct_change()` with pandas 3's default (no forward fill)."""
    if not values:
        return []
    return [NAN] + [
        divide(values[index], values[index - 1]) - 1.0 for index in range(1, len(values))
    ]


def shift(values: Sequence[float], periods: int) -> list[float]:
    """`Series.shift(periods)` on a positionally-indexed series."""
    if periods <= 0:
        raise ValueError("shift expects a positive period")
    return ([NAN] * periods + list(values))[: len(values)]


def rolling_max(values: Sequence[float], period: int) -> list[float]:
    """`Series.rolling(period).max()` — NaN until the window fills, and NaN
    for any window containing one (unlike bare `Series.max()`)."""
    return [NAN if window is None else max(window) for window in _windows(values, period)]


def rolling_min(values: Sequence[float], period: int) -> list[float]:
    """`Series.rolling(period).min()`."""
    return [NAN if window is None else min(window) for window in _windows(values, period)]


def rolling_mean(values: Sequence[float], period: int) -> list[float]:
    """`Series.rolling(period).mean()`."""
    return [
        NAN if window is None else sum(window) / len(window)
        for window in _windows(values, period)
    ]


def argmax(values: Sequence[float]) -> int:
    """`numpy.argmax`: the first NaN wins outright, ties go to the first index."""
    nan_index = _first_nan(values)
    if nan_index is not None:
        return nan_index
    best = max(values)
    return next(index for index, value in enumerate(values) if value == best)


def argmin(values: Sequence[float]) -> int:
    """`numpy.argmin`: the first NaN wins outright, ties go to the first index."""
    nan_index = _first_nan(values)
    if nan_index is not None:
        return nan_index
    best = min(values)
    return next(index for index, value in enumerate(values) if value == best)


def row_max(left: Sequence[float], right: Sequence[float]) -> list[float]:
    """`pd.concat([left, right], axis=1).max(axis=1)` — skips NaN per row."""
    return [nanmax((a, b)) for a, b in zip(left, right, strict=True)]


def row_min(left: Sequence[float], right: Sequence[float]) -> list[float]:
    """`pd.concat([left, right], axis=1).min(axis=1)` — skips NaN per row."""
    return [nanmin((a, b)) for a, b in zip(left, right, strict=True)]


def fillna(values: Sequence[float], replacement: float) -> list[float]:
    """`Series.fillna(replacement)`."""
    return [replacement if math.isnan(value) else value for value in values]


def replace_zero_with_nan(values: Sequence[float]) -> list[float]:
    """`Series.replace(0, numpy.nan)` — used to make a degenerate band or an
    untraded bar propagate as "no value" instead of dividing by zero."""
    return [NAN if value == 0.0 else value for value in values]


def _windows(values: Sequence[float], period: int) -> list[Sequence[float] | None]:
    """One entry per row: the full window, or `None` where pandas would emit
    NaN (the leading rows before the window fills, and any window holding a
    NaN — `min_periods` defaults to the window size)."""
    if period <= 0:
        raise FactorError("factor.invalidParameter")
    out: list[Sequence[float] | None] = [None] * len(values)
    for index in range(period - 1, len(values)):
        window = values[index - period + 1 : index + 1]
        if not any(math.isnan(value) for value in window):
            out[index] = window
    return out


def _first_nan(values: Sequence[float]) -> int | None:
    if not values:
        raise FactorError("factor.insufficientHistory")
    return next((index for index, value in enumerate(values) if math.isnan(value)), None)
