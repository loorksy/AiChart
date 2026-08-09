# Third-Party Notices — AiChart Web

## QuantDinger-derived Quant Agent surfaces

Parts of the Quant Agent feature in `web/` are adapted from
[QuantDinger](https://github.com/OpenByteInc/QuantDinger), Copyright Open Byte
Inc., licensed under the Apache License, Version 2.0. A copy of the license is
available at http://www.apache.org/licenses/LICENSE-2.0 and verbatim in this
repository at `quant-agent/LICENSES/apache-2.0-safe_exec.txt`.

This file is the index. **The per-file record is the header comment inside each
file**, which names the exact upstream source (file and, where it matters, line
range) and states what changed and why. That is deliberate: a change is only
reviewable next to the code it changed, and a central ledger that paraphrases
forty headers goes stale the first time one of them is edited. The list below
exists so the obligation is discoverable from the package root rather than only
by grepping.

Every file listed carries such a header. `grep -rl QuantDinger web/src` is the
authoritative, always-current list; if that command returns a file that is not
covered by a heading below, this index is the thing that is out of date.

### The split that governs all of it

Only the web-side halves are here. The deterministic engine — scoring,
consensus, outlook, validation, the factor library, the bot engines — lives in
`quant-agent/`, has no outbound network, and is documented in
`quant-agent/NOTICE.md`. The MCP tool surface is documented in `mcp/NOTICE.md`.
The division is not cosmetic: web holds the LLM call, data collection, auth,
billing and persistence; `quant-agent/` holds every number that a
recommendation depends on.

### Analysis (Wave 1)

`src/lib/quantAgent/analysis/*`, `src/lib/quantAgent/analysisStore.ts`,
`src/app/api/quant-agent/analysis/**`, `src/app/quant-agent/analysis/**`,
`src/components/quantAgent/analysis/*`.

Adapted from `backend_api_python/app/services/fast_analysis.py` and its
`_scoring` / `_formatters` siblings, plus the Vue analysis views. The prompt
assembly, the rendered field set and the section order follow upstream; the
scoring itself does not live here.

### Chat, quick tools and memory (Wave 2)

`src/lib/agent/quantAgentChat/*`, `src/components/quantAgentChat/*`.

Adapted from upstream's assistant surface. Where AiChart lacks an upstream
input (fundamentals, news, crypto derivatives), the component is reported
ABSENT rather than substituted with a placeholder number.

### Monitors, signal history and webhook dialects (Wave 3)

`src/lib/quantAgent/signalEventStore.ts`,
`src/lib/quantAgent/notifications/webhookDialect.ts`,
`src/lib/quantAgent/webhookDelivery.ts`,
`src/app/api/quant-agent/signals/**`,
`src/components/quantAgent/signals/*`.

Adapted from `app/services/indicator_signal_alerts.py`,
`app/services/notifications/webhook.py` and
`app/services/signal_notifier.py`. Two differences are worth naming here
because they are security-relevant rather than stylistic:

- **Outbound webhooks are SSRF-hardened.** Upstream hands a user-supplied URL
  straight to `requests.post`. `webhookDelivery.ts` resolves the hostname,
  refuses private and link-local addresses, connects to the pinned address
  while validating TLS against the original hostname, follows no redirects, and
  bounds the response body.
- **Vendor detection is anchored.** Upstream classifies a webhook's vendor with
  `prefix in url.lower()`, a substring search over the whole URL. Because the
  vendor decides where the operator's signing secret goes, that lets any host
  claim a vendor by embedding the vendor's path in its own.
  `detectWebhookDialect` compares the hostname for equality and the path as a
  prefix.

### Bots (Wave 3) — simulation only

`src/lib/quantAgent/bots/*`, `src/lib/quantAgent/botStore.ts`,
`src/app/api/quant-agent/bots/**`, `src/app/quant-agent/bots/**`,
`src/components/quantAgent/bots/*`.

Adapted from upstream's grid/DCA/martingale configuration and live-trading
surfaces. **The live-trading half is not ported.** AiChart's bots replay a
configuration against historical candles and report what would have happened;
`assertBotExecutionAllowed()` in `src/lib/quantAgent/bots/brokerPort.ts` throws
unconditionally, with the environment flag both unset and set, and
`SimulatedQuantBroker` in `quant-agent/` is the only implementation of the
broker port anywhere in the repository.
