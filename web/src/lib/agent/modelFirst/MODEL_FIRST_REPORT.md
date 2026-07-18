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

Exact IDs are **not hardcoded**. After deploy, admin must run **تحديث الفحص** (`POST /api/admin/config/trading-models`) under the production OpenAI key. Record probe results (id, available, supportedReasoningValues) in ops notes before treating the selector as finalized.

Until probe cache is warm, composer falls back to allowlisted stub IDs (`gpt-4.1`, `o3-mini`, `o4-mini`) for local/dev only.

## Rollback

- Set `MODEL_FIRST_MODE=shadow` or `off` and restart `aichart-web`.
- Redeploy previous known-good commit if needed.
- Candidate builders remain in tree for history/replay until dependency-proof deletion.

## Capture retention

In-process temp capture bookkeeping TTL: **10 minutes** (`getTempCaptureRetentionMs`). Base64 images are not logged.
