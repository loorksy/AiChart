# Third-Party Notices

## safe_exec.py sandboxing mechanism

`app/sandbox/safe_exec.py` is adapted from [QuantDinger](https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0.
A copy of the license is available at http://www.apache.org/licenses/LICENSE-2.0
and is included verbatim in this repository at
`quant-agent/LICENSES/apache-2.0-safe_exec.txt`.

Changes made from the original: pandas/numpy import support and their
IO-method blocklist (`read_csv`, `to_csv`, `savez`, etc.) were removed
entirely, since this service's generated strategy code operates on plain
Python floats/lists with no pandas/numpy dependency — this also removes
the defensive checks that existed solely to guard pandas/numpy-specific
attack surface (`_dangerous_pd_numpy_*`, `_PANDAS_NUMPY_ROOTS`, related
regex patterns, and the numpy-submodule entries in
`_DANGEROUS_SUBMODULE_ATTRS`). The AST/regex validation, restricted
builtins, module proxy, timeout mechanism, and subprocess isolation
(`safe_exec_isolated`) are otherwise unchanged in mechanism from the
original.

## Deterministic analysis core (`app/engine/analysis/`)

`app/engine/analysis/scoring.py`, `consensus.py`, `outlook.py`,
`constrain.py`, `memory.py` and the endpoints in `app/api/analysis.py` are
adapted from [QuantDinger](https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Upstream sources:
`backend_api_python/app/services/fast_analysis_scoring.py`,
`.../fast_analysis.py`, `.../fast_analysis_formatters.py` and
`.../analysis_memory.py`.

Every weight, band, cap, clamp and rounding rule is reproduced unchanged —
including upstream behaviours that look accidental (the "extra" bucket's
fixed 0.15 weight regardless of what it accumulated; the
`max(1.0, weight_sum)` divisor; the `or`-style horizon fallbacks that treat
an exactly-zero score as missing). Changes made from the original:

- **Split along the network boundary.** Upstream's `FastAnalysisService`
  collects market data, assembles prompts, calls an LLM and persists results
  inside one method. This service has no outbound network, so only the
  deterministic middle was ported; `web/` pushes the collected inputs in and
  owns the LLM call, persistence, auth and billing. `_collect_market_data`,
  `_build_analysis_prompt` and everything under
  `services/market_data_collector.py` are therefore not ported.
- **`fast_analysis_geo.py` is not ported.** Classifying news *text* for
  geopolitical risk belongs on the side of the split that has the text, so
  `web/` tags each news item with `geopolitical_level` and this service
  applies upstream's exact penalty arithmetic (-42 severe, -18 moderate,
  cumulative floor -55, `is_global_event` promoted to moderate).
- **No prose is generated.** Upstream appends bracketed Chinese sentences to
  `summary` when the indicator veto or the consensus override fires, and
  renders the trend outlook as a Chinese/English summary string. AiChart is
  Arabic-first with its own i18n dictionaries, so this service reports what
  it changed structurally instead (`applied.decision_overridden_by`,
  `applied.indicator_conflicts`, and the outlook's `label`/`qualifier`
  fields) and never rewrites `summary`.
- **Calibration thresholds are constants.** `_get_ai_calibration` reads a
  `qd_ai_calibration` table; there is no such table here, so upstream's own
  documented defaults (+20/-20 decision thresholds, 15.0 minimum consensus
  override, 0.7 quality-hold threshold) are module constants.
- **Dead code left behind:** `FastAnalysisService._calculate_indicators`
  (unreachable and broken upstream) and the ensemble/confidence-calibration
  paths, which are env-gated off by default upstream.

The quant-agent-specific "compile and discover" contract
(`app/engine/strategies/generated_code/contract.py`) and the strategy
interpreter (`app/engine/strategies/generated_code/interpreter.py`) are
new, independent code written for this service's much smaller
`evaluate(features) -> dict | None` contract — they are not a port of
QuantDinger's `strategy_v2/contract.py`, which implements a full
portfolio/order/schedule trading engine contract that has no equivalent
here.
