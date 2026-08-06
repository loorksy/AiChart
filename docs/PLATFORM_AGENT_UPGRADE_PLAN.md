# Platform & Agent Upgrade Plan

**Scope:** Improve the existing platform with its current feature set — no new product surface.
Two goals: (1) make the agent professional — correct analysis, correct entries, an engineered
decision pipeline instead of a system-prompt-bound bot; (2) rebuild the chat experience, memory,
and UI/UX to the standard of modern agent products.

**Grounding:** Every claim below was verified against the code in this repository (file paths and
line numbers cited), not against the design documents in `docs/`. Reference inspirations:
[HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) (chat/run experience),
[TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
(layered memory), [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
(agent presentation: streaming tool output, interrupt-and-redirect),
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (DESIGN.md method).

**Deliverable style:** design + engineering plan. No code in this document.

---

## 0. Verified diagnosis — why recommendations land far from the market

The "excellent sell entry, but price is far away" complaint is not a prompt-wording bug. It is the
combined effect of four layers, each confirmed in code:

| # | Layer | Verified fact | Where |
|---|-------|--------------|-------|
| 1 | Doctrine | The decision prompt hard-codes: *"direction: buy or sell. A successful analysis ALWAYS produces one. There is no wait"* and allows a `conditional` plan whose entry "waits for … a better price". The model is therefore **forced** to output a direction on every run, and its only escape hatch when price is badly positioned is to hang the plan on a distant level. | `web/src/lib/agent/agents/finalDecisionSynthesizer.ts:354-355` |
| 2 | Geometry thresholds | `classifyActivation()` treats up to **4 ATR** away as an acceptable `conditional` plan, and even 4–8 ATR still returns `conditional` instead of rejecting (the `rejectActivationAtr: 8` constant is effectively dead — the branch at line 134 returns `conditional` too). On scalping timeframes 4–8 ATR is hours-to-days away. | `web/src/lib/agent/trading/scalpGeometry.ts:15-20,117-134` |
| 3 | Write-path gate | The shared plan validator checks plan type, execution state, levels, invalidation, validity — but has **no entry-distance check at all**. Nothing at write time compares `entry` to the current price. | `web/src/lib/recommendations/canonical/planContract.ts:87-190` |
| 4 | Wiring gap | `classifyActivation` is only imported by the internal candidate builder (`buildTradeCandidates.ts:199`). The recommendation write route — the path MCP `create_recommendation` and the platform both use — never calls it. The only distance-aware valve is both too loose **and** disconnected from the path that matters. | `web/src/app/api/agent/recommendation/route.ts:1-60` (imports `validateCompletePlan`, `deriveExecutionState`; no geometry import) |

Aggravating factors, also verified:

- The net-return filter silently **drops** candidates below `minNetTp1R = 2.5` instead of tagging
  them (`buildTradeCandidates.ts:237,557`), starving the model of near-price options and pushing it
  toward distant "clean" levels.
- The synthesizer is text-only in the platform path (fleet agents summarize; the decision model
  never sees the chart), while chart images exist and are captured elsewhere
  (`web/src/lib/agent/orchestrator.ts:910,1175-1241`, `chart/multiTimeframeCapture.ts`).

**Conclusion:** fix the contract and the wiring, not the prompt.

---

## Phase 1 — Recommendation Quality: the Tradability Gate

**Goal:** the agent still always has a market view (buy/sell — product identity preserved), but a
plan is only published as an *actionable recommendation* when its entry is realistically reachable.
Distant-entry ideas become explicitly labeled "watch" items with proximity alerts — never
presented as ready trades.

### 1.1 New leaf module: `web/src/lib/recommendations/tradability.ts`

Pure function (same dependency-free pattern as `planContract.ts`) computing, from
`{entry, currentPrice, atr, spread, timeframe, planType, validityCandles}`:

- `entry_distance_atr` — |entry − price| / ATR
- `entry_distance_spread` — |entry − price| / current session spread
- `expected_bars_to_activation` — distance / median per-bar range
- `tradability` — `now` | `soon` | `watch_only` | `rejected`

Publication rules (constants live here, one place):

- `immediate` plans must be ≤ ~0.4 ATR (keep current value).
- `anticipatory`/`conditional` plans cap at ~1.5 ATR for `soon`; beyond that → `watch_only`.
- `expected_bars_to_activation > validityCandles` → `watch_only` (a plan that cannot trigger
  inside its own validity window is not a trade).
- Beyond a hard ceiling (~3 ATR) or entry closer than ~2× spread → `rejected`.
- Exact numbers are tuned in 1.5 against historical data; the structure is what's fixed.

### 1.2 Wire the gate into the single write path

- `web/src/app/api/agent/recommendation/route.ts` — after `validateCompletePlan`, fetch the live
  price (it already imports `getUnifiedPrice`) and ATR (via `getLatestClosedCandle` /
  `candleRepository`), call the tradability module, persist the verdict, and refuse to store
  `rejected` plans (structured error telling the model to re-plan near price, mirroring the
  existing corrective-retry mechanism in `__tests__/synthesizerCorrectiveRetry.test.ts`).
- `web/src/lib/agent/trading/buildTradeCandidates.ts` — replace the silent `minNetTp1R` drop with
  a tag (`net_r_below_preferred`), so near-price candidates reach the model annotated instead of
  disappearing.
- `web/src/lib/agent/trading/scalpGeometry.ts` — make `rejectActivationAtr` actually reject;
  align constants with 1.1 (or re-export them from the new module so there is exactly one source).

### 1.3 Contract and schema

- Add `tradability`, `entry_distance_atr`, `expected_bars_to_activation` to the recommendation
  projection (`web/src/lib/recommendations/types.ts`, canonical repository, and the MCP
  `create_recommendation` schema in `mcp/src/tools/schemas/coreSchemas.ts` +
  `agent/tools/contract.json` via `npm run contract:export`).
- `watch_only` items: store with the existing lifecycle but surfaced under "Trade Ideas / Watch"
  in the recommendations UI, and arm the already-implemented-but-unused entry-proximity kind
  (`ProximityKind` includes `"entry"` in `web/src/lib/monitor.ts:78`, but only `sl`/`tp` are
  checked; wire an entry check into `web/src/lib/recommendations/recommendationTracker.ts` so the
  user gets "price is approaching your entry" instead of a stale distant recommendation).

### 1.4 Doctrine text — the honest reframe

Update `agent/workspace/SYSTEM.md`, `agent/workspace/AGENTS.md`, and the synthesizer prompt
(`finalDecisionSynthesizer.ts:354-355`): keep "always a direction", add "an actionable entry is
earned, not invented — if the current price is not workable, output the view with
`tradability: watch_only` and the level to watch; never dress a distant level as a conditional
trade". Both surfaces read the same files, so one edit covers Web + MCP.

### 1.5 Calibration loop

Nightly job (extend the existing cron family in `web/src/app/api/cron/`) comparing declared
tradability vs. realized outcome (activated within validity? bars-to-activation actual vs.
predicted) from `recommendation_outcomes` / `recommendation_transitions`. Report feeds the
threshold constants in 1.1 and shows up in the admin diagnostics.

### Acceptance

- Unit tests for the tradability module (distance/validity/spread matrices).
- Integration test: MCP-shaped `create_recommendation` payload with entry 5 ATR away is refused;
  1 ATR away on a conditional plan stores as `soon`; watch items never render as actionable cards.
- Reference-scenario suite (`web/src/lib/agent/__tests__/referenceScenarios.integration.test.ts`)
  extended with "price far above resistance, sell setup below" → expect `watch_only`, not a
  distant sell recommendation.

---

## Phase 2 — A professional agent core, not a prompt-bound bot

**Goal:** the decision is produced by an engineered pipeline — deterministic evidence in, validated
contract out, self-checked, vision-grounded, and measured — with the LLM as one stage, not the
whole system. Most of the skeleton already exists; this phase closes the gaps.

### 2.1 Vision-grounded decisions on the platform path

The MCP path reads chart images; the platform synthesizer does not. Feed the existing
multi-timeframe captures (`web/src/lib/chart/multiTimeframeCapture.ts`) into
`finalDecisionSynthesizer.ts` as image parts next to the numeric evidence (the
`VISION_DECISION_V1` flag in `featureFlags.ts` already reserves this). Rule stays: images confirm
shape; every number quoted must come from numeric context.

### 2.2 Structured self-check before publish

Add a cheap verification pass after the synthesizer, before the envelope: does the stop side match
the direction, do targets clear costs, does the entry sit at a detected level
(`detect_levels` output), does the plan contradict fresh structure events? Failures trigger one
corrective retry with the named defect (the retry plumbing already exists —
`synthesizerCorrectiveRetry`), then an operational-blocker envelope, never a silently bad card.

### 2.3 Kill the hidden WAIT-reproducers and hidden caps

Sweep the confirmed list: silent net-return filter (done in 1.2), the forming-pattern
"don't cite / weaker" prompt line, the hidden confidence ceiling in the synthesizer, "mid-range =
WAIT" phrasing in `dataQualityPolicy.ts` / `rangePosition.ts`, and "defaulting to WAIT" in risk
fallbacks. Add a CI text-guard test that greps for the banned phrases so they cannot return.

### 2.4 Decision measurement

Every published decision already has a run trace (`runTrace.ts`) and parity log (`parityLog.ts`).
Add per-decision quality metrics: activation rate, time-to-activation, hit rate by tradability
class, and corrective-retry rate — aggregated into the existing admin metrics
(`web/src/lib/metrics.ts`). This is what makes the agent "professional": its accuracy is a
monitored number, not a vibe.

### Acceptance

- Doctrine scenario tests updated (`doctrineScenarios.test.ts`) — no hidden-WAIT phrase passes CI.
- A/B window: fraction of published recommendations with `entry_distance_atr ≤ 1.5` should rise
  sharply; activation-within-validity rate becomes a tracked KPI.

---

## Phase 3 — Chat experience rebuilt (Vibe-Trading / hermes-agent patterns)

**Goal:** the user watches the agent work — stages, tools, reasoning status — instead of staring
at a spinner, and can steer mid-run.

Current state: SSE endpoint exists (`web/src/app/api/agent/chat/stream/route.ts`), with activity
events (`lib/agent/activity.ts`), a one-line thinking ticker (`AgentThinkingTicker.tsx`), an
activity timeline (`AgentActivityTimeline.tsx`), and run steps (`runTrace.ts`). The pieces exist
but the experience is a single collapsing line, not a structured run view.

### 3.1 Stage protocol over the existing SSE channel

Formalize event types: `run_started` → `stage(fetch|structure|liquidity|mtf|news|risk|decide|
verify|render)` with status running/done/failed + duration → `tool_call(name, args_summary,
result_summary)` → `reasoning_status` (sanitized headline via the existing
`sanitizeActivityMessage`) → `token_delta` for the final answer → `run_finished(usage)`.
Map stages 1:1 from the orchestrator fleet (the `Promise.all` block at `orchestrator.ts:910` and
the synthesizer call at `:1175`) — no new backend logic, just emission at boundaries that already
exist. Heartbeat every ~3s during long stages (Vibe-Trading pattern) so the UI never dead-airs.

### 3.2 Run view in the chat (`web/src/components/agent/`)

- Replace the single ticker line with a collapsible **run card**: stage checklist with live
  status, expandable tool rows (what was fetched, how long), then the streamed answer.
  Sanitization stays server-side (activity.ts) — no chain-of-thought leaves the server.
- Persist the run card with the message (run trace is already stored) so reopening a chat shows
  *how* an answer was produced — Vibe-Trading's Run Detail, inside the thread.
- **Interrupt & redirect** (hermes pattern): a stop button that aborts the orchestrator run
  server-side (AbortController through `callLLM` / agent timeouts in `lib/agent/timeout.ts`) and
  keeps the partial run card; typing during a run queues a redirect.
- **Context chips** above the composer (Vibe pattern): active symbol, timeframe, account, trade
  mode — already resolved server-side (`sessionOptions.ts`, `tradeMode.ts`); surface them as
  removable chips instead of hidden state.
- Keep chat state when navigating away mid-run (the recent "don't remount the agent panel
  mid-send" fixes are the start; move stream ownership into a client store so navigation never
  drops a live run).

### 3.3 Streamed final answer

Today the platform answer arrives as one envelope. Stream the final synthesis text token-by-token
through the same SSE channel (`token_delta`), rendering markdown progressively — the single
biggest perceived-speed win. Cards (recommendation, levels) still arrive as structured payloads
after their data is validated.

### Acceptance

- Streaming route emits the full event vocabulary; UI tests for stage card states.
- p50 "first visible signal" < 1s (first stage event), even when total run is 30–60s.
- Interrupting a run leaves a well-formed partial card and no orphaned server work.

---

## Phase 4 — Layered memory (TencentDB-Agent-Memory model, our storage)

**Goal:** the agent accumulates experience per user: raw exchanges refine automatically into
facts, scenarios, and a persona, and the right layer is retrieved on demand — instead of today's
mix of an in-process 2h preference map (`sessionMemory.ts`), semantic memories with writes
disabled (`AGENT_MEMORY_WRITE_V1` off in `featureFlags.ts`), and disconnected lessons.

Adopt the L0–L3 structure over the existing PostgreSQL/SQLite stack (no new database):

| Layer | Content | Backing |
|---|---|---|
| L0 conversation | Raw messages + tool results | existing `chatHistory/chatStore.ts` |
| L1 atoms | Extracted facts/preferences/constraints/outcomes | existing `semanticMemory.ts` rows, typed by the `AGENT_MEMORY_TYPES` list in `agentMemory.ts` |
| L2 scenarios | Per-symbol / per-strategy context blocks (e.g. "user's XAUUSD scalping profile", built from lessons + outcomes) | new table, assembled asynchronously |
| L3 persona | Stable trader profile (risk comfort, sessions, style) | extend Trading DNA (`docs/TRADING_DNA.md` implementation) as the L3 source |

Work items:

1. **Async refinement pipeline** — extend the existing daily cron (`/api/cron/daily-summary`) to
   distill L0→L1 (turn on guarded memory writes: promote `AGENT_MEMORY_WRITE_V1` with the
   existing contradiction/duplicate checks in `agentMemory.ts`) and assemble L1→L2 scenario blocks.
2. **Layered retrieval** — `recallAgentMemoryForContext` (already called in the stream route,
   line 47) returns L3+L2 as cheap bootstrap context every run; L1/L0 lookup only on demand
   (specific question or matching symbol/timeframe), with item-count and character budgets —
   on-demand retrieval, not wholesale injection.
3. **Memory transparency UI** — a "what I remember about you" panel (settings) listing L1/L2/L3
   entries with delete/correct actions; every remembered fact is user-visible and revocable.
4. **Decision integration** — L2 scenario block joins the evidence bundle (it strengthens or
   weakens; it never vetoes — consistent with the doctrine).

### Acceptance

- Same question two weeks apart reflects accumulated lessons (fixture test through the refinement
  pipeline).
- Memory writes pass the safety classifier and contradiction check; deletes cascade.
- Retrieval budget respected (bounded tokens per run, measured in `tokenBudget.ts` accounting).

---

## Phase 5 — UI/UX system (awesome-design-md method)

**Goal:** one written design system the whole product (and future AI-assisted work) obeys.

1. Author `web/DESIGN.md` with the nine standard sections (theme, palette+roles, typography,
   component styles, layout, elevation, do/don'ts, responsive, agent prompt guide), extracted
   from the current Tailwind v4 tokens and the better existing components (`components/ui/shell`,
   `components/squareui`) — codifying what exists, then tightening it.
2. Normalize the agent surfaces against it first (chat panel, run cards, recommendation cards,
   notification center) — they are the product's face.
3. RTL/LTR parity rules (the product is Arabic-first, `lib/i18n/ar.ts` / `en.ts`): mirror-safe
   spacing, number formatting, one money format (the recent equity/credit chip fix becomes a
   documented rule).
4. Add the DESIGN.md conformance note to `CLAUDE.md` so future generated UI follows it.

### Acceptance

- DESIGN.md exists and the agent surfaces pass a visual review against it (light+dark, ar+en).

---

## Python / FastAPI

Already present: `research-service/` is Python + FastAPI (deterministic backtester, statistical
validation, research swarm). Recommendation: **extend it, don't add another service**. Heavy
compute stays there (backtests, case-memory indexing for `find_similar_cases`, tradability
threshold calibration batch jobs). Everything touching money, guards, approvals, and broker
execution stays in the Next.js service where the execution guards live (`lib/agent/risk/*`,
`executionGuardAgent.ts`, trade readiness). The Vibe-Trading-style chat runtime does **not**
require a Python rewrite — the SSE stage protocol in Phase 3 is an emission change in the
existing Node path.

---

## Order, dependencies, rollout

1. **Phase 1** first — it is the user-visible pain and is contract + wiring work (1–2 weeks scale).
2. **Phase 3** next — chat experience is independent of the decision work and lands visible value.
3. **Phase 2** in parallel behind flags (vision decisions, self-check) — each item has a feature
   flag in the existing `featureFlags.ts` pattern with staged rollout.
4. **Phase 4** after Phase 2.4 metrics exist (memory quality needs decision metrics to prove it
   helps).
5. **Phase 5** DESIGN.md early (cheap), surface normalization continuous.

Every phase ships behind a flag, with the validation suite from `README.md` (web lint/test/build,
mcp typecheck/catalog/schemas, research-service pytest) plus the new tests named above.

---

## What explicitly does not change

- The canonical recommendation lifecycle, its append-only evidence tables, and the
  `BEFORE UPDATE` guards (`web/src/lib/recommendations/canonical/*`).
- Execution safety: approval flow, trade readiness, position sizing, kill switches.
- The single-constitution model (`agent/workspace/SYSTEM.md` feeding Web + MCP) — edited, not
  replaced.
- Billing, tiers, and the MCP tool surface (extended with new fields, not reshaped).
