# Third-Party Notices — AiChart MCP Server

## Quant Agent analysis tool surface (`src/tools/quantAnalysis.ts`)

`src/tools/quantAnalysis.ts` and `src/tools/schemas/quantAnalysisSchemas.ts`
are adapted from [QuantDinger](https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Upstream source:
`mcp_server/src/quantdinger_mcp/server.py` — its `MCP_TOOL_NAMES` surface,
specifically the signal-alert CRUD block and the two guards every mutating
tool there carries: `_idempotency_headers` (an `idempotency_key` required on
every mutating tool, maximum 120 characters) and `delete_signal_alert`'s
`confirm_delete=true is required` refusal.

Changes made from the original:

- **The execution tools are not ported.** Upstream's surface includes
  `place_quick_order`, `stop_strategy`, `emergency_stop_trading` and
  `cancel_open_paper_orders`. AiChart's Quant Agent is an analysis engine with
  its own isolated store and no broker reach; nothing in its MCP group may
  place, close, cancel, modify, or size an order.
  `src/tools/__tests__/noExecutionTools.test.ts` enforces that by tool name, by
  input field, by contract risk class, and by the set of bridge paths the quant
  handlers can address.
- **Analysis is the headline capability, and it is new.** Upstream's MCP surface
  exposes strategies, jobs and factors; its fast-analysis engine is reachable
  only from its own web application. `quant_agent_run_analysis`,
  `quant_agent_get_analysis`, `quant_agent_list_analyses` and
  `quant_agent_analysis_accuracy` have no upstream counterpart — they wrap the
  AiChart web routes ported in Wave 1.
- **Upstream's alert CRUD becomes typed monitor CRUD.** `create_signal_alert`
  takes an opaque `payload: dict` validated server-side; the monitor tools here
  declare their real fields, so a host can complete them and a malformed call
  fails before the wire. `src/tools/__tests__/quantRouteParity.test.ts` compares
  every declared field against the zod schema of the web route it reaches.
- **The refusals use this platform's envelope.** Upstream raises a `ValueError`
  for a missing idempotency key and returns a bespoke `{"error": true, …}` dict
  for a missing `confirm_delete`. Both are returned here as the canonical
  `{ok: false, error: {code, message}}` bridge failure envelope, so a client
  needs one error path rather than two.
- **The idempotency key is enforced in this process, not by a header.**
  Upstream sends `Idempotency-Key` to a server that honours it. AiChart's
  `/api/quant-agent/*` routes do not yet run through
  `withBridge({idempotent: true})`, and this server's `BridgeClient` cannot
  attach a custom header, so the key deduplicates a retried tool call within one
  MCP session and nothing wider. The scope is stated in the tool descriptions
  and in the code, rather than implied to be durable.
- **Field names are camelCase** (`idempotencyKey`, `confirmDelete`), matching the
  web routes these tools call and the existing `open_trade` tool, rather than
  upstream's `idempotency_key` / `confirm_delete`.
