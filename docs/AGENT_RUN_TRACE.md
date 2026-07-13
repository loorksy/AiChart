# Agent Run Trace

The existing `agent_audit_logs` compliance record remains unchanged. The Phase 1 foundation adds tenant-scoped `agent_runs`, `agent_run_steps` and `agent_tool_calls`; artifact storage remains a typed reference interface for a later phase.

Runs store request/session/chat identity, symbol/timeframe, intents, status/timestamps, public decision/confidence/risk veto, safe error code, feature flags, context version/counts, recalled-memory count, selected skill/tool names and aggregate token usage. Steps store a bounded public-safe summary and redacted structured evidence. Tool calls store name/version/permission/status/duration, redacted bounded previews, normalized error, retry count and timestamps.

Raw reasoning, full conversation history, environment dumps, credentials and unrestricted payloads are not schema fields. Private-key content is rejected and other detected secrets are redacted. Writes are tenant guarded and failure-isolated; a trace failure logs safely and never fails the user request.

The stream route starts/finalizes traces only when enabled and records completed, failed and cancelled terminal states:

```text
AGENT_RUN_TRACE_V1=0
```

Rollback is immediate by disabling the flag. Tables are additive and may be retained safely. Physical rollback may drop tool calls, steps, then runs in that order after export; no destructive rollback runs automatically.
