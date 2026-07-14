# Research Swarm security model

The only caller is the authenticated AiChart server. Browser code never receives the service token or supplies authoritative tenant identity. Every endpoint validates internal auth and tenant/request headers; every lookup includes ownership.

The container runs as `10001:10001`, with read-only root, dropped capabilities, `no-new-privileges`, bounded resources, no Docker socket/public port, and an internal network. Only artifact/work volumes are writable; SQLite must resolve inside the work root.

The swarm exposes no shell, subprocess, `eval`, `exec`, dynamic import, generated Python, arbitrary path/HTTP/query, broker/MT5 credential, order method, chart write, approval, or execution permission. Roles/presets are immutable. Outputs, evidence, upstream context, and skills are untrusted data and cannot modify policy or guards.

Requests are bounded and secret/private-key content is rejected. Metadata is redacted/limited. Evidence types and IDs are allowlisted and owner must match tenant. Supported facts and calculations need evidence. Hidden-reasoning keys are recursively rejected. Raw prompts, environment, headers, secrets, complete tool bodies, and conversation history are not persisted.

SQLite foreign keys, WAL, transactions, unique tenant idempotency, transition allowlists, and append-only events make changes auditable. Outputs and usage are immutable inserts. Startup fails abandoned work safely. Artifacts have controlled names/types, scoped directories, traversal/symlink rejection, atomic writes, hashes, and limits. Cancellation shares the artifact lock.

Fixed queues/workers, per-run concurrency, task/depth/time limits, heartbeat, stale cancellation, bounded retry, usage/event/artifact budgets, and graceful shutdown contain abuse/failure. Partial results remain labeled partial. Failures return normalized codes rather than stacks.

Rollback disables both swarm flags. It does not alter Phase 0–5 paths or delete durable tenant state automatically.
