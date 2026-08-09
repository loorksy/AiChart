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

## Analysis outcome validation and threshold calibration

`app/engine/analysis/calibration.py` and the extensions to
`app/engine/analysis/memory.py` (outcome correctness, confidence-bucket
accuracy) are adapted from [QuantDinger](https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Upstream sources:
`backend_api_python/app/services/analysis_memory.py`
(`validate_unvalidated_older_than`, `get_confidence_accuracy_by_bucket`,
`get_adjusted_confidence`) and `.../ai_calibration.py`
(`AICalibrationService`).

The ±2%/±5% correctness rule, the `10..30` candidate threshold grid, the
80-sample minimum, the five confidence buckets, the 5-sample-per-bucket floor
and the `0.5 + (raw - 50)/100` calibration formula are reproduced value for
value. Changes made from the original:

- **No database, no self-modification.** Upstream's reflection worker reads
  and updates `qd_analysis_memory` on a daily thread, and its calibration
  worker writes the winning threshold into `qd_ai_calibration` so later
  analyses silently decide on tuned numbers. This service owns neither table
  and has no network: `web/` selects the aged rows, fetches each realised
  price, and posts `/analysis/validate` and `/analysis/calibrate`. The
  calibration answer is a REPORT — nothing in this service starts deciding
  differently because of it, and `consensus.py`'s live thresholds are the
  single source `calibration.DEFAULT_THRESHOLDS` reads from.
- **Two upstream defects are deliberately corrected** (both documented at the
  top of `app/engine/analysis/memory.py`):
  1. `_vol_bands_similar` tests membership of `{low, normal, normal_low}` and
     `{high, elevated, volatile, very_high}`. `"medium"` — one of only three
     levels the indicator pipeline emits — is in neither, so medium-vs-low
     scored 0 exactly like medium-vs-high. An ordinal ladder (low 0, medium 1,
     high 2) awards the same 0.08 partial-band weight when two levels are at
     most one step apart; every pair upstream already handled keeps its score.
  2. `get_confidence_accuracy_by_bucket` writes the top bucket as `"90_101"`
     while `get_adjusted_confidence` reads `"90_100"`, so a 90+ confidence
     never calibrated. Both now read one `CONFIDENCE_BUCKETS` table.
- **A skipped row is reported, not dropped.** Upstream `continue`s past an
  analysis whose stored or realised price is non-positive; `/analysis/validate`
  returns it under `skipped` with a reason, because scoring it as a 0% move
  would silently record a correct HOLD.
- **`min_samples` can only be raised.** Upstream's caller passes it freely;
  here the endpoint floors it at `MIN_CALIBRATION_SAMPLES` so a decision
  boundary can never be tuned on a handful of rows.
- **Not ported:** the `reflection.py` daemon thread and its
  `ENABLE_REFLECTION_WORKER` / `REFLECTION_WORKER_INTERVAL_SEC` environment
  gates (scheduling belongs to `web/`'s cron), the
  `AI_CALIBRATION_CANDIDATE_ABS_THRESHOLDS` env override, `actual_outcome`
  (a column upstream never writes), and `user_feedback` / `get_performance_stats`.

## Built-in factor library (`app/engine/factors/`)

`app/engine/factors/frame.py`, `compute.py`, `registry.py`, `models.py` and the
endpoints in `app/api/factors.py` are adapted from
[QuantDinger](https://github.com/OpenByteInc/QuantDinger), Copyright Open Byte
Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Upstream sources:
`backend_api_python/app/services/factors/registry.py`,
`.../app/services/factors/__init__.py`, `backend_api_python/app/routes/factors.py`
and `.../app/routes/agent_v1/research.py`. The English display names come from
`quantdinger-vue/src/locales/lang/en-US.js`.

All 61 built-in factors are ported — 54 technical and 7 fundamental — with
upstream's categories, direction hints, required fields, default parameters,
parameter-schema generator and warm-up arithmetic reproduced value for value.
Their numbers are frozen in `tests/test_factors_golden.json`, which was
produced by running the UPSTREAM implementation (pandas 3.0.5) over fixed
synthetic series; 122 of the 127 numeric cases are bit-exact against it and the
remaining five differ by at most one unit in the last place. Changes made from
the original:

- **No pandas, no numpy.** This service depends on fastapi/pydantic/uvicorn
  only, and its sandbox whitelists the stdlib alone, so every kernel was
  rewritten in pure Python against `frame.py`'s stand-ins. Those stand-ins
  reproduce pandas' semantics rather than Python's where they differ: skipna
  reductions, NaN-propagating rolling windows, numpy's non-raising division
  and logarithm, and numpy's "first NaN wins" `argmax`/`argmin`.
- **Upstream's numerical quirks are reproduced, not corrected.** Bar 0
  contributes `high - low` to the true range (so `atr`, `atr_pct`,
  `supertrend`, `vortex`, `choppiness` and `keltner_channels` sit one bar off
  TA-Lib); `bollinger_bands` uses the population deviation while the z-score
  factors use the sample one; the ADX loop advances its Wilder sums one step
  late and returns the leaked `plus_di`/`minus_di` loop locals; KDJ seeds K and
  D at 50.0 and iterates the whole frame; a single untraded bar makes
  `amihud_illiquidity` NaN; every EMA is SMA-seeded at index `period - 1`.
  `tests/test_factors_subtleties.py` pins each of these against an
  independently derived expectation, so losing one names itself.
- **`version` is real.** Upstream hard-codes `"1.0.0"` on all 61 factors, keeps
  it out of every cache key and has no bump mechanism, so a formula edit
  silently invalidates stored research. Here each declaration owns its version
  and `app/engine/factors/fingerprint.py` hashes the kernel's own token stream
  plus its transitive helpers; `tests/test_factors_version.py` freezes both, so
  changing a formula fails CI until the version is bumped. All 61 start at
  `"1.0.0"`, so today's numbers are still upstream's numbers.
- **`availability` is explicit.** A factor that could not be reproduced here
  would have to be declared unavailable with a reason rather than dropped or
  approximated. None had to be: all 61 are `available`.
- **`talib_adapter.py` is NOT ported.** It hard-imports the TA-Lib C extension
  and enumerates it reflectively; there is nothing to reimplement short of
  reimplementing TA-Lib, and the extension is not installed here. Upstream's
  own degraded contract is kept instead — `GET .../factors` reports
  `talib_available: false` and `talib_count: 0`, and a `talib:`-prefixed id
  raises upstream's `factor.talibUnavailable` rather than `factor.notFound`, so
  a client written against QuantDinger behaves here exactly as it does there
  without the extension. Upstream's `_builtin_indicator_contract` alias table
  (`strategy_v2/runtime.py`) is not ported either: silently renaming a caller's
  parameters belongs in a strategy runtime, not in a data endpoint.
- **Data is pushed in.** Upstream's runtime reads its own market database
  before calling `compute_factor`; this service has no egress, so bars — and,
  for the seven fundamental factors, point-in-time fundamental columns — ride
  in on the request. AiChart has no fundamentals feed today, so those seven
  return `factor.missingFields` until `web/` sources one: absent input reported
  as absent, never filled in.
- **A NaN result is serialized as JSON `null` with `is_nan: true`.** Upstream
  leans on Flask emitting the non-standard `NaN` literal. The meaning is
  unchanged — this factor has no defined value for these bars — but the
  response stays parseable.
- **`parameter_schema` keeps its upstream inconsistency.** It advertises
  `minimum: 1` for every integer while the `_period` guard rejects anything
  below 2. The schema is the frozen wire contract the factor-library UI
  renders, so it is reproduced rather than quietly tightened; the compute path
  is the authority.
- **Descriptions are not carried.** Upstream stores `factor.{id}.description`
  and resolves it in the Vue locale files. Only the English `name` is inlined
  here; prose belongs to `web/`'s Arabic/English dictionaries, the same call
  the analysis engine made.
- **Not ported:** `factors/research.py` (winsorize / IC / quantile buckets),
  `compute_panel_factor`'s Flask callers, `strategy_v2/factor_research.py`'s
  separate cross-sectional engine, and the universe/watchlist model. Only
  `compute_panel_factor` itself came across, because the registry's own
  contract includes it. `tests/test_factors_golden_regen.py` is the
  regeneration recipe for the golden fixture, not a test.

## Automated bot engines (`app/engine/bots/`) — SIMULATION ONLY

`app/engine/bots/levels.py`, `config.py`, `validator.py`, `cells.py`,
`engine.py`, `fill_handler.py`, `ladders.py`, `simulated_broker.py` and the
endpoints in `app/api/bots.py` are adapted from
[QuantDinger](https://github.com/OpenByteInc/QuantDinger), Copyright Open Byte
Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Upstream sources:
`backend_api_python/app/services/grid/{levels,config,validator,engine,fill_handler,resting_orders_repo,poller,runner}.py`,
`.../app/services/live_trading/{grid_cells,exchange_orders,records}.py`,
`.../app/services/strategy_runtime/executors.py` and
`.../app/services/strategy_runtime/robot_v2.py` (the bar-crossing fill rule).

The grid algorithm is ported whole — arithmetic and geometric level generation,
the lines-versus-cells duality, the five-state cell machine, the fee-coverage
and minimum-spread gates (byte for byte, including which cell they name), the
budget/quantity arithmetic, entry arming with its neutral round-robin, the
weighted-average cost basis on partial entries, one-reduce-only-exit coverage,
the cycle-preserving entry re-hang, the boundary actions, and the
`filled_quantity` / `processed_fill_qty` watermark that makes ledger posting
recoverable. The martingale, layered-martingale and DCA ladders are ported from
the executor previews, `trend` excluded (see below).

**The execution boundary is the point of this port.** Upstream's `GridEngine`
is coupled to nine exchange clients through eleven `self._create_client()`
calls. Here the engine has exactly one outward dependency, the five-method
`QuantBrokerPort` (`app/engine/bots/engine.py`), and this repository contains
exactly ONE implementation of it: `SimulatedQuantBroker`, which fills limit
orders against bars `web/` pushes in. `tests/test_no_execution.py` asserts both
halves structurally — no module under `app/engine/bots/` imports a network
library or calls `__import__`/`importlib`, and no second class anywhere in the
tree either declares the port as a base, registers as a subclass, or even
structurally satisfies its five methods. Adding real execution therefore
requires a new class and a new import in a reviewed diff; there is no
configuration value that can do it.

Changes made from the original:

- **Nothing that talks to a venue was ported.** `exchange_orders.py`
  (`place_grid_limit_order`, `execute_grid_market_order`, `cancel_grid_order`,
  `query_grid_order_fill`, `normalize_grid_order_quantity`), `poller.py`'s REST
  polling loop with its per-credential rate budget, `fill_units.py`'s nine
  per-venue field maps, `exchange_requirements.py`'s account-mode queries and
  `runner.py`'s client construction are all absent. Their *decisions* survive —
  the poller's fill/watermark reconciliation, the normalizer's floor-never-round
  contract, the runner's startup and tick ordering — reimplemented over local
  state.
- **`normalize_quantity` is total.** Upstream fetches instrument metadata over
  REST on every single order and returns `0.0` from a blanket `except`, which
  callers read as "skip" — one flaky venue call silently disables an entire
  grid. Here the instrument spec is pushed in as data and the flooring is
  arithmetic that cannot raise. Flooring, never rounding up, is upstream's rule
  and is kept: an exit must never offer more than the cell owns.
- **The exchange-ownership guards collapse to one that still means something.**
  `_grid_entry_ownership_allowed`, `_resolve_grid_exit_quantity`,
  `resolve_reduce_only_quantity` and `clamp_spot_close_quantity` exist to stop a
  live engine selling inventory it does not own on a credential shared with
  other strategies. A simulated account has no other party, so what remains is
  the local clamp: an exit is limited to the strategy ledger's own leg size
  minus what other open exits already reserve.
- **No initial-position exchange recovery.** `_try_recover_initial_from_exchange`,
  `_probe_initial_client_order_fill`, the 0.85/1.05 tolerance band, the
  three-attempt/30-second retry throttle and the frozen pre-start position
  baseline all answer "did my order actually reach the venue?", which cannot be
  in doubt here. The initial leg's SIZING is ported exactly, neutral 50/50 split
  included, and the deterministic initial client-order id is kept because that
  determinism is the duplicate-open guard.
- **Resting client-order ids are deterministic.** Upstream mixes
  `int(time.time())` into them so repeat placements on one cell stay distinct; a
  replay must be reproducible, so an explicit `seq` the caller owns replaces the
  wall clock. Format and 32-character truncation are unchanged.
- **`order_frequency` counts bars, not seconds.** A replay has no wall clock.
  The default of 0 disables the throttle, exactly as upstream.
- **Neutral grids warn instead of hard-blocking.**
  `validate_neutral_grid_exchange_support` refuses to start a neutral grid whose
  account is not verified in hedge mode. A simulated account has no such
  setting, so `SimulatedQuantBroker.hedge_mode()` is `True` and the gate would
  only obstruct the simulation the user asked for.
- **Logs and the auto-stop lifecycle are data.** `append_strategy_log` writes to
  Postgres and `auto_stop_live_strategy` stops a live deployment. The same log
  strings, formatted identically, accumulate on the run report; a boundary
  `stop_loss` still requests the stop and still books the qty-0 close-all (zero
  means "close everything", not "close nothing").
- **Persistence is SQLite, and every accessor is owner-scoped.** `qd_grid_cells`
  and `qd_grid_resting_orders` become in-memory repositories with the same query
  shapes for the duration of a run, and the finished run is written to
  `quant_bots` / `quant_bot_runs` / `quant_bot_fills` / `quant_bot_ledger`.
  `owner_user_id` is denormalized onto all four and the store offers no unscoped
  `get_bot`, so a by-id handler cannot look a bot up without saying whose it is.
- **`trend` is dropped.** Upstream lists it in `KNOWN_BOT_TYPES`,
  `BOT_TYPE_MARKETS` and the recommender prompt, but nothing anywhere consumes
  `maPeriod`/`maType`/`confirmBars`/`positionPct` — it is a parameter schema
  with no engine, and offering it would be offering a bot that cannot run.
- **`execution_mode` can only be `signal`, and it selects nothing.** Upstream's
  `signal | live` field forks in `pending_order_worker._dispatch_one`, where a
  row queued as `signal` is silently UPGRADED to `live` if the strategy row says
  so. That auto-upgrade is not ported, and neither is the fork: there is no live
  branch to take.
- **Upstream behaviours reproduced rather than corrected:** `grid_count` means
  boundary lines unless `gridCountUnit` says cells; `config.pct` clamps
  negatives while `ladders.ratio` does not; `pct(1)` is 100%; a grid cell's PnL
  overrides the FIFO answer on every exit (`fill_handler.py`); a dropped
  degenerate rung leaves a gap in the cell indexes rather than renumbering them;
  the layered-martingale volume multiplier restarts per layer while prices
  compound across layers.
- **Not ported:** `build_executor_strategy_payload` and `_executor_code`
  (credential minting and Python source generation for a runtime that does not
  exist here), `robot_v2.py`'s generated bar-replay sources, `grid_runtime.py`'s
  adaptive bounds and waterfall protection (pandas-dependent, and this service
  has no pandas), `ledger_reconcile.py`'s phantom-clearing CLI, the
  `strategy_bot_recommend.py` LLM recommender (it needs a model, so it lives in
  `web/`), and every route that starts, stops or deploys a bot.

The quant-agent-specific "compile and discover" contract
(`app/engine/strategies/generated_code/contract.py`) and the strategy
interpreter (`app/engine/strategies/generated_code/interpreter.py`) are
new, independent code written for this service's much smaller
`evaluate(features) -> dict | None` contract — they are not a port of
QuantDinger's `strategy_v2/contract.py`, which implements a full
portfolio/order/schedule trading engine contract that has no equivalent
here.
