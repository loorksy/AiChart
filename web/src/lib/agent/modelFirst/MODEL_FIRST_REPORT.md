# Model-First Live Market Intelligence — Release Report

Base: `ed8d529` (`origin/main`). Feature flag: `MODEL_FIRST_MODE=off|shadow|live` (default **live**).

## Verified contracts (code)

1. **Responses `store: false`** — enforced in `callOpenAIResponses` / `buildTradingResponsesBody` (unit-tested).
2. **No candidate authority in live model input** — `buildNeutralEvidence` + `assertNoCandidateAuthority`; live path skips `runRiskAgent` / `buildTradeCandidates`.
3. **Validator cannot flip direction** — `validateTradePlanTechnically` preserves BUY/SELL/WAIT; one repair pass locks original decision.
4. **Neutral Vision** — QuickChart via `buildChartSnapshotBufferForMarket` with empty overlays; never MT5; optional user-context image labeled separately.
5. **Platform TF binding** — `platformChartBoundScope` / `user_selected_chart`.
6. **Admin** — API key + capability probe refresh; per-user trading model picker removed; `AI_MODEL` seed/fallback only.
7. **Composer** — model + capability-dependent reasoning selectors; prefs in `trading_settings`.
8. **MCP host separation** — documented on `/api/agent/model` and `/api/agent/models`.

## Production model IDs

The product allowlist is exact and ordered:

1. `gpt-5.6-sol`
2. `gpt-5.6-terra`
3. `gpt-5.6-luna`
4. `gpt-5.5`
5. `gpt-5.5-pro`

Old or arbitrary IDs are rejected even if they remain in a persisted registry. The composer fails closed until the admin runs **تحديث الفحص** (`POST /api/admin/config/trading-models`) with the production OpenAI key. Only models that pass Responses API, structured-output, and Vision probes are shown. The admin response also lists any approved IDs absent from the provider catalogue.

No production or local fallback fabricates capability records. Record only safe diagnostics (`id`, availability, supported reasoning values, timestamps, and error codes) in the deployment notes; never record the API key or full provider responses.

## Rollback

- Set `MODEL_FIRST_MODE=shadow` or `off` and restart `aichart-web`.
- Redeploy previous known-good commit if needed.
- Candidate builders remain in tree for history/replay until dependency-proof deletion.

## Capture retention

In-process temp capture bookkeeping TTL: **10 minutes** (`getTempCaptureRetentionMs`). Base64 images are not logged.
