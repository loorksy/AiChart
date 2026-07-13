# Research Service Security Model

## Trust boundary

The Research Service is a separate process authenticated by its own internal bearer token. Tenant
and request headers are considered only after service authentication. Possession of the token does
not bypass tenant matching: job, event, cancellation, and artifact lookups also match the stored
positive user ID. Unknown and cross-tenant resources return the same response.

The current in-memory stores are volatile and are not a production durability boundary. A future
database adapter requires a dedicated least-privilege schema; AiChart's production DB credentials
must not be supplied to the service.

## Capability boundary

Phase 3 adds pure research libraries for strict strategies, controlled datasets, deterministic
simulation, metrics, and statistical validation. It does not add broker, MT5, account, approval,
recommendation, or order capabilities.

The service never accepts:

- Python/JavaScript/shell/MQL source or expressions;
- dynamic imports, pickle, subprocesses, or user callbacks;
- arbitrary URLs or unrestricted HTTP;
- arbitrary filesystem paths, symlinks, or traversal;
- production database or broker credentials;
- a readiness label as live-trading authorization.

Sensitivity's evaluator parameter is an internal trusted integration callable. It is not part of a
user payload or dynamic import surface.

## Dataset and resource safety

CSV/Parquet paths are resolved under an authorized artifact root with suffix, size, existence,
traversal, root-escape, and symlink checks. Warehouse export is bounded JSON and never opens a DB or
network connection. Rows, bytes, symbols, date range, simulations, windows, sensitivity grids,
queue depth, timeout, retries, artifacts, and artifact bytes are bounded.

Parquet rejects nested/unsupported types and reads bounded batches without worker threads. PyArrow
is pinned; an incomplete deployment still fails closed if it is unavailable.

## Secrets, logs, and artifacts

Production refuses a weak/missing internal token. Configuration reads an explicit
`RESEARCH_SERVICE_*` allowlist. Logs/responses do not contain bearer tokens, raw payloads, artifact
contents, private keys, exception stacks, or hidden reasoning. Recursive redaction and size limits
apply to progress/error fields.

Artifacts are tenant/job scoped beneath a dedicated root, checked against traversal and symlink
escape, written atomically, bounded, and SHA-256 identified. APIs expose references rather than an
arbitrary file browser.

## Container and network

The image runs as UID/GID 10001 with a read-only root filesystem, tmpfs work area, dedicated
writable volumes, all capabilities dropped, no-new-privileges, an internal network, and resource
limits. No Docker socket, source tree, browser, SSH material, or source-control credential is
mounted. `RESEARCH_SERVICE_NETWORK_MODE=disabled` is the default.

Container isolation cannot make arbitrary code safe; the code-free input contract remains
mandatory.

## Integration status

Phase 3 jobs now have aligned typed payloads, no-retry enforcement, cooperative cancellation,
tenant-scoped artifacts, and server-only feature flags. Artifact-backed inputs and validation
references are resolved against the requesting tenant. Inline warehouse input and the web helper
share the 8 MiB Phase 3 envelope bound, while a strategy specification remains capped at 48 KiB.
Statistical work runs off the event loop and checks cancellation within bounded loops. The
large-payload regression flow preserves the code/path/URL prohibitions. There is no public research
API or UI in the current scope.
