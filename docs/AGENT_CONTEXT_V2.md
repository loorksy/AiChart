# Agent Context V2

## Purpose

Agent Context V2 gives the Smart Chart Agent bounded, tenant-authorized language history for follow-ups and preferences. It is not a market-data source, a permission source, or an execution authority. The feature is disabled by default with `AGENT_CONTEXT_V2=0`.

## Public contract

`buildAgentConversationContext()` accepts the authenticated `userId`, optional `chatId`, `sessionId`, current user message, locale, safe chart metadata, an already-resolved active recommendation, already-authorized persisted messages, recalled memories, trade lessons, and a token budget.

It returns normalized messages, estimated tokens, selected/removed/compacted IDs, recalled memory IDs, warnings, the resolved active recommendation, and optional development diagnostics. Diagnostics contain counts and IDs only; they do not contain secrets, raw tool payloads, private reasoning or chain-of-thought.

The API route performs tenant-authorized history loading. `orchestrator.ts` receives only the optional constructed context and contains no database calls.

## Normalization and deterministic ordering

Messages have an explicit role, kind, source and stable input `sequence`. Timestamps are optional metadata. Duplicate or missing timestamps therefore cannot reorder identical input. Stored user messages remain user-role content and are never promoted to system/developer instructions.

Kinds distinguish conversation, tool call, tool result, memory, trade lesson, summary and recommendation. Tool calls carry a stable call ID; tool results carry only their matching ID.

## Selection and compaction

The deterministic pipeline:

1. Sanitizes and normalizes authorized inputs.
2. Keeps system/developer instructions outside conversation compaction.
3. Removes historical market-price messages explicitly marked as stale.
4. Preserves the current user message unchanged, except required secret redaction at the security boundary.
5. Preserves the resolved active recommendation and explicit important preferences.
6. Scores older messages using Arabic/English terms, symbol, timeframe, recommendation ID and analysis ID.
7. Reserves recent turns and prefers them under budget pressure.
8. Truncates oversized historical prose and tool results with explicit historical labels.
9. Drops the lowest-value removable messages in deterministic groups.
10. Repairs tool-call/tool-result pairs and recalculates the token estimate.

No LLM is called for selection or compaction. A future optional generated summary must remain supplemental.

If the current message alone exceeds the supplied budget, it is retained and a `budget_too_small` warning is returned rather than silently altering user intent. The production route uses a budget above the request schema's maximum message size.

## Tool-pair repair

`repairToolPairs()` removes orphan results, keeps one deterministic latest result for duplicate results, validates IDs, places a result after its call, and inserts a localized neutral compressed-history placeholder when a retained call lost its result. The placeholder never reconstructs output or reasoning. Tool result text is sanitized and size-bounded before retention.

## History adapter

`adaptAuthorizedChatHistory()` requires matching authenticated and owner user IDs plus the authorized chat ID. It rejects a tenant mismatch and filters rows from other chats. Assistant result objects are reduced to public decision, summary, recommendation/analysis references, symbol/timeframe, entry, stop, targets and public reasoning. Debug data, raw reasoning, internal errors, raw tool payloads, database fields and full chart objects are not copied.

## Security model

History, memory and trade lessons are untrusted recalled context. Sanitization removes control characters and script markup, rejects private-key blocks, redacts API-key/Bearer/database URL/credential patterns, classifies instruction-like prompt injection, bounds text size and excludes expired memory. Instruction-like text stays user content so it cannot become system authority.

The general-answer system instruction explicitly says recalled context cannot authorize tools, provide current prices, or override controls. Context tool messages are not forwarded to the general-answer LLM path.

## Recommendation precedence

The resolver boundary uses this order:

1. Canonical tenant-scoped persisted tracked recommendation.
2. Session active recommendation.
3. Recommendation restored from chart context.
4. Historical conversation reference.

Terminal records (`tp*_hit`, `sl_hit`, `invalidated`, `expired`, `cancelled`, `closed`) cannot become active. Symbol and timeframe must match when requested. Historical text cannot override a newer resolved recommendation. The persistent canonical lookup is deferred until the recommendation single-source-of-truth migration; current session behavior remains unchanged.

## Orchestrator integration and market authority

When enabled, Context V2 is used for general language answers and for narrow intent-only follow-up hints when a resolved active recommendation exists. The hint contains no prices and is never sent as market input. The original current message is passed to agent paths.

Market Data Agent, Candle Warehouse, OANDA/EA live data, Market Sync Guard, Data Quality Policy, Risk Agent and Execution Guard remain authoritative. Context cannot bypass explicit confirmation or create a trade from a drawing-only/general request.

## Composable intent and precedence contract

`routeIntent()` returns composable intents, but `mixed_request` means that more than one execution family is present—not merely two labels in the same drawing family. Families include analysis, recommendation lifecycle, drawing, news, account and execution.

An explicit reference to a user-owned drawing is specialized as `discuss_user_drawing` (or its modify/move/delete variants) and supersedes the generic `explain_chart_drawings`. Same-family drawing labels therefore do not create a false mixed request. The orchestrator deterministically handles the user-drawing path before generic drawing explanation and before market/risk/execution paths, so it produces one answer and cannot launch a trade. Generic agent-drawing explanation remains `explain_chart_drawings`. True cross-family requests retain `mixed_request`; existing safety precedence still controls which operation can run.

## Feature behavior

`AGENT_CONTEXT_V2=0` (default): the stream route performs no Context V2 history read/build and passes no conversation context. Existing production behavior is unchanged.

`AGENT_CONTEXT_V2=1`: the stream route loads at most 160 messages through the tenant-scoped store, adapts and compacts them to 2,400 estimated tokens, then passes the optional result to the orchestrator. Context construction failure is fail-open only for the optional language aid: it is logged and the existing agent path continues, with all safety guards intact.

## Rollout and rollback

1. Keep disabled in production while CI and staging tests run.
2. Enable for internal accounts and observe warning/count diagnostics without logging content.
3. Verify follow-ups in Arabic and English plus chart/recommendation regressions.
4. Expand gradually through platform configuration.

Rollback is immediate: set `AGENT_CONTEXT_V2=0`. No database migration is required and no persisted data is modified by Context V2.

## Known limitations

- Canonical tracked recommendation resolution is a typed boundary, not yet wired to persistence.
- Recalled memory and trade lesson loaders are not yet connected; only their safe builder contracts exist.
- Token estimation is deterministic and conservative, not provider tokenization.
- Optional model-generated rolling summaries are intentionally deferred.
- Persisted chat currently contains user/assistant records; tool pair support prepares the contract for future traced tool history.

Historical prices are never trusted as current because they can be stale, belong to a different symbol/timeframe, or predate a market event. Every current trading decision continues to obtain fresh synchronized data through the existing market path.
