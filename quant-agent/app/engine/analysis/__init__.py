"""Deterministic analysis core: the rule layer that surrounds `web/`'s LLM call.

Nothing in this package fetches anything. `web/` collects prices, indicators,
news and macro series, POSTs them to `app/api/analysis.py`, and this package
turns them into objective scores, a multi-timeframe consensus, a trend
outlook, and — after the LLM has answered — a constrained, indicator-vetoed
trading plan.

The arithmetic is a port of QuantDinger's `fast_analysis` service
(https://github.com/OpenByteInc/QuantDinger), Apache-2.0. Every weight,
threshold and clamp is upstream's; the module split, the typed inputs and the
push-not-pull data flow are ours. Per-module headers record what changed.
"""
