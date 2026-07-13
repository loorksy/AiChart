# Agent Memory

## Existing system reused

AiChart already stored `semantic_memories` with PostgreSQL pgvector / SQLite JSON embeddings and stored `trade_lessons` with tenant, trade, recommendation, symbol, timeframe and outcome provenance. Memory lifecycle summaries, explicit archive/delete behavior and embedding failure handling already existed. Phase 1 extends these stores; it does not add Markdown memory or a parallel table.

## Findings and changes

Before Phase 1, semantic memory had tenant scoping and soft archive but no expiry, confidence, safety classification, source IDs, locale/market metadata or use counters. Embedding-query failure returned no semantic memories. Trade Lessons had stronger provenance and a symbol fallback but were not connected to Context V2.

`semantic_memories` now adds `source`, `memory_type`, `confidence`, `safety_classification`, `expires_at`, `last_used_at`, `use_count`, source chat/message/recommendation/trade IDs, locale, symbol, timeframe and strategy ID. PostgreSQL and SQLite bootstrap/migration paths contain the same logical columns and recall index. Existing rows remain valid through non-destructive defaults.

`recallAgentMemoryForContext()` returns at most five memories and three Trade Lessons. Ranking combines semantic/keyword score, confidence, recency, symbol, timeframe and locale. Embedding failure uses a tenant-scoped keyword fallback. Recall failures return empty bounded results and warnings; they never fail an agent request.

All recalled text passes Context V2 sanitization. Expired and private-key content is excluded; secrets are redacted; instruction-like text stays untrusted user context. Prices in memory never become current market truth.

## Writing

`classifyAgentMemoryCandidate()` recognizes only durable risk/trading/chart/strategy preferences and corrections. Greetings, transient prices, credentials and arbitrary prompt instructions are rejected. Explicit writes use the existing semantic store. Automatic writes are disabled by default:

```text
AGENT_MEMORY_WRITE_V1=0
```

## Rollout and rollback

Enable Context V2 first, observe ID/count-only logs, then evaluate recall quality. Disable `AGENT_CONTEXT_V2` to stop recall injection and `AGENT_MEMORY_WRITE_V1` to stop candidate writes. The additive migration is data-preserving. A physical rollback should export data, remove the recall index, then drop only the added metadata columns manually; no destructive rollback runs automatically.
