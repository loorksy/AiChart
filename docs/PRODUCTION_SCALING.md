# AiChart Production Scaling Runbook

This runbook turns the scaling checklist into deployable operating rules. It does
not claim that code alone can support thousands of active traders: production
capacity comes from replicas, managed stateful services, observability, load
validation, backups, and safe releases.

## Target profile

| Tier | Minimum production shape | Notes |
| --- | --- | --- |
| Web | 2+ `web` replicas behind a load balancer | The app must be treated as stateless; shared state belongs in PostgreSQL/Redis. |
| MCP | 2+ `mcp` replicas when Claude connector traffic grows | Point `AICHART_API_URL` at the internal web load balancer. |
| Worker | 2+ `worker` replicas | Scale independently from web; tune `WORKER_CONCURRENCY`. |
| Database | Managed PostgreSQL + pooling | Use PgBouncer or provider pooling; never use SQLite for production scale. |
| Cache/locks | Managed Redis with auth/TLS | Required for shared cache, rate limits, BullMQ, and cross-replica locks. |
| Static assets | CDN in front of Next.js/static assets | Keep API/SSE paths unbuffered and routed to origin. |

## Required environment gates

Production is not ready until these variables are set and verified:

- `DATABASE_URL` points to PostgreSQL, with SSL enabled when outside a private network.
- `REDIS_URL` points to shared Redis; use `REDIS_PASSWORD`/TLS when non-loopback.
- `METRICS_TOKEN` protects `/api/metrics` unless metrics is private-network only.
- `SENTRY_DSN` is set for error reporting.
- `CRON_SECRET`, `APP_SECRET`, `ENCRYPTION_KEY`, `AICHART_SERVICE_TOKEN`, and
  `MCP_AUTH_SECRET` are generated secrets, not defaults.
- `AICHART_SELF_URL` is set when web replicas are behind a load balancer.

## Load balancer rules

- Route `/api/healthz` as liveness.
- Route `/api/readyz` as readiness; remove an instance from rotation when it returns 503.
- Disable proxy buffering for SSE paths (`/api/chat`, `/api/market/analyze`, MCP streaming paths).
- Keep API timeouts above the longest allowed analysis/execution request.
- Preserve `X-Forwarded-*` headers for audit/security.

See `infra/nginx/aichart-load-balancer.example.conf` for an Nginx example.

## PostgreSQL and pooling

- Start with managed PostgreSQL sized for write-heavy chat/trade metadata.
- Put PgBouncer/provider pooling between replicas and PostgreSQL.
- Set `PGPOOL_MAX` conservatively per replica; total connections must stay below DB limits.
- Run backups with point-in-time recovery. Test restore monthly.
- Add slow query monitoring before increasing traffic.

## Redis and queues

Redis is mandatory once more than one web/worker replica runs because cache,
rate-limit counters, BullMQ jobs, and locks must be shared.

- Use managed Redis with persistence appropriate for BullMQ jobs.
- Monitor memory, evictions, latency, connected clients, and failed jobs.
- Scale worker replicas before scaling `WORKER_CONCURRENCY` too high.
- Alert when dead-letter jobs increase.

## Rate limiting and abuse control

Keep route-level limits for:

- `/api/chat` and chart-analysis routes.
- `/api/agent/*` bridge writes.
- `/api/trades/*` execution actions.
- auth/register/login endpoints.

The goal is not only security; it protects model spend, broker APIs, and worker
queues under bursts.

## Observability

Required stack:

- Prometheus scraping `/api/metrics` with `METRICS_TOKEN`.
- Grafana dashboards for HTTP latency, 5xx, DB/Redis readiness, job failures,
  broker status, stale quotes, and chat stream failures.
- Sentry releases and environments enabled via `SENTRY_DSN`.
- Central JSON logs via Loki, OpenSearch, Datadog, or CloudWatch.

Minimum alerts:

- `/api/readyz` degraded for 2 minutes.
- Error rate > 1% over 5 minutes.
- p95 API latency above target.
- Redis down/evicting keys.
- PostgreSQL connection saturation.
- BullMQ dead jobs > 0.
- Broker/EA quote staleness beyond policy.

## Load tests

Use `infra/loadtest/k6-chat-smoke.js` as a smoke baseline. Run it against staging
first, then production during a maintenance window with trading execution mocked
or disabled. Never load-test live trade execution paths with real broker keys.

Suggested gates:

1. 100 virtual users for 10 minutes: no crashes, p95 `/api/healthz` < 250ms.
2. 1,000 active users: web replicas stay below 70% CPU and memory, Redis has no evictions.
3. Chat streaming test with mocked LLM: no browser/page crashes and no unbounded memory growth.

## Backups and restore

- PostgreSQL: daily full backup + WAL/PITR if available.
- Redis: enable persistence only if BullMQ recovery requirements demand it.
- Secrets: store in a secret manager, not only `.env` files.
- Restore drills: monthly, documented, timed.

## CI/CD and release safety

The baseline GitHub Actions workflow is in `.github/workflows/ci.yml`.
A production deploy should add:

- Docker image build and scan.
- Migration dry-run.
- Staging deploy.
- Smoke checks for `/api/healthz`, `/api/readyz`, `/api/chat/status`, and MCP health.
- Blue/green or rolling deployment with automatic rollback on readiness failure.

## Blue/green deployment checklist

1. Deploy the new green stack with the same PostgreSQL/Redis but no public traffic.
2. Run migrations that are backward-compatible with the blue stack.
3. Run smoke tests and k6 smoke profile.
4. Shift 5% traffic, then 25%, then 100% while monitoring readiness/errors.
5. Keep blue warm until the rollback window closes.
