# AiChart Quant Agent

An isolated FastAPI process that runs a second, genuinely independent
trading-decision engine ("quant-agent"). It turns market bars into
transparent, rule-based buy/sell recommendations. It has no broker, MT5,
account, approval, or live-order capability, and it never talks to the main
AiChart application's database, `mt_accounts`, `trading_settings`, or the
canonical `recommendations` table/guardrails (`singleBrainGuard`).

Market data model: **push, not pull**. `web` collects candles the same way
it already does for `get_ohlc`/`get_forex_indicators`, then POSTs them to
this service. quant-agent makes **no outbound network calls at all**
(`QUANT_AGENT_NETWORK_MODE=disabled` is the default and the only supported
value) — it only ever reacts to its own inbound API. All indicators
(EMA/RSI/MACD/ATR/Bollinger/ADX) are computed here, from the raw bars, not
recycled from any other agent.

## Local run

```bash
python -m pip install -e ".[dev]"
export QUANT_AGENT_INTERNAL_TOKEN="replace-with-at-least-32-random-characters"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8091
```

Liveness is public:

```bash
curl -s http://127.0.0.1:8091/health/live
# {"status":"live","service":"aichart-quant-agent","version":"0.1.0"}
```

Readiness and every `/internal/quant-agent/*` endpoint require the bearer
token:

```bash
curl -s http://127.0.0.1:8091/health/ready \
  -H "Authorization: Bearer $QUANT_AGENT_INTERNAL_TOKEN"
```

## Decision engine

Two deterministic strategies ship in this version (`app/engine/strategies/`):

- `ema_trend_v1` — EMA20/EMA50 crossover, gated by an EMA200 trend filter
  and an ADX14>20 strength gate. Immediate near EMA20, otherwise
  conditional on a pullback to EMA20. Stop = 1.5x ATR14; targets are a
  1R/2R/3R ladder.
- `rsi_reversion_v1` — RSI14 extreme plus a Bollinger(20,2) band touch,
  gated to `regime=="range"`. Immediate entry; stop = 1x ATR14 beyond the
  touched band; target is the Bollinger middle band.

`app/engine/combine.py` arbitrates when more than one strategy fires on the
same bar: single fire wins outright; on agreement the strategy whose
`regime_affinity` matches the current regime wins and the other is recorded
as corroborating evidence; on disagreement the regime-matched strategy wins
and the conflict is written into `rationale` rather than hidden. No firing
strategy at all is a valid, first-class outcome (`"no_signal"`) — this
service is not obligated to always name a direction the way Lonora's
chat-facing analysis is.

Generate a recommendation:

```bash
curl -s -X POST http://127.0.0.1:8091/internal/quant-agent/recommendations \
  -H "Authorization: Bearer $QUANT_AGENT_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "market": "forex",
    "interval": "M15",
    "owner_user_id": 1,
    "request_id": "req-example-0001",
    "bars": [{"time": "2026-01-01T00:00:00Z", "open": 1.1, "high": 1.101, "low": 1.099, "close": 1.1005}, ...]
  }'
```

List / fetch:

```bash
curl -s "http://127.0.0.1:8091/internal/quant-agent/recommendations?symbol=EURUSD&state=active" \
  -H "Authorization: Bearer $QUANT_AGENT_INTERNAL_TOKEN"

curl -s http://127.0.0.1:8091/internal/quant-agent/recommendations/<id> \
  -H "Authorization: Bearer $QUANT_AGENT_INTERNAL_TOKEN"

curl -s http://127.0.0.1:8091/internal/quant-agent/strategies \
  -H "Authorization: Bearer $QUANT_AGENT_INTERNAL_TOKEN"
```

## Storage

`app/storage/sqlite.py` owns a private SQLite database
(`QUANT_AGENT_DB_PATH`, default `quant-agent.sqlite3` inside
`QUANT_AGENT_WORK_DIR`), WAL mode, and a single `asyncio.Lock` serializing
access — the same discipline as
`research-service/app/storage/sqlite.py`. Three tables:
`quant_recommendations`, `quant_recommendation_events` (lifecycle log),
`quant_strategy_defs` (registry introspection / future enable-disable).
`(owner_user_id, idempotency_key)` is unique, so re-submitting the same bar
close for the same strategy deduplicates instead of creating a duplicate
row. `owner_user_id` is recorded for audit only; unlike Lonora's
account-bound recommendations, quant-agent recommendations are symbol-based
and are not visibility-scoped per user (see the engineering plan, section
4).

## Tests

```bash
python -m pip install -e ".[dev]"
python -m pytest
```

## Security boundaries

- No broker/MT5 credentials of any kind exist in this service.
- No outbound HTTP client is used anywhere in the code.
- The only auth is a shared internal bearer token
  (`QUANT_AGENT_INTERNAL_TOKEN`), checked with a constant-time comparison.
- No automatic trade execution exists in this version — recommendations
  only.
