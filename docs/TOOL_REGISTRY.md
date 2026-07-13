# Common Agent Tool Registry

The common contract is an incremental boundary; existing deterministic agent functions and the current MCP server remain in place.

Each definition owns a name/version, Zod input/output schemas, read-only/repeatable flags, timeout, permission, risk/cost classes, required feature flags/providers, availability and execution functions. Server context—not a model or Skill—supplies permissions, providers and flags.

The executor validates input and optional output, enforces availability/policy, passes AbortSignal, applies timeout, normalizes errors, supports non-repeatability and idempotency hooks, and emits secret-redacted bounded telemetry. It returns no raw stack or chain-of-thought. Normalized codes cover not found, unavailable, denied, invalid input/output, timeout, abort, provider and internal failures.

The first adapters are read-only:

- `market_snapshot` (`market.read`, fresh market provider required).
- `active_recommendation_read` (`recommendation.read`, tenant user ID supplied by server context).

No shell, arbitrary HTTP/Python/file/database tool or live execution tool was introduced. The MCP adapter preserves definition schema and permission behavior while leaving current MCP names/responses untouched.
