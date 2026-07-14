# Trading DNA

Trading DNA is a tenant-scoped, evidence-only behavioural view derived from
AiChart's canonical recommendation lifecycle. It is analytical: it never
changes recommendations, trades, Risk Guard limits, Gold Agent weights, broker
state or Research Service artifacts.

## Evidence

The collector reads bounded rows from:

- canonical recommendations and immutable outcomes;
- recommendation learning events;
- real trades linked through trade intents;
- explicitly validated Trade Lessons;
- tenant-verified successful Research Service job/artifact references.

Every supported metric and conclusion contains canonical recommendation IDs,
trade IDs, learning-event IDs and/or backtest job/artifact IDs. Cross-tenant
references are rejected. Missing source fields produce
`insufficient_evidence`; they are not estimated.

## Metrics and gates

| Metric | Minimum recorded observations | Source |
| --- | ---: | --- |
| Risk tolerance | 3 | `risk_used` outcomes |
| Average R | 3 | `r_multiple` outcomes |
| Holding time | 3 | `holding_ms` outcomes |
| MAE / MFE | 3 each | recorded outcome excursions |
| Win/loss behaviour | 3 | success/failure learning events |
| Session/symbol/timeframe/strategy preference | 1 (confidence grows with sample) | canonical recommendations |
| Break-even / trailing behaviour | 3 completed recommendations | canonical outcomes |
| Risk scaling | 5 | chronological `risk_used` values |
| Drawdown/recovery | 5 | chronological recorded R or PnL path |
| Confidence calibration | 5 | recommendation confidence vs success/failure |
| Execution consistency | 3 | spread, slippage and commission outcomes |
| Portfolio concentration | 3 | recommendation symbol shares |
| Backtest coverage | 1 | verified Research Service job references |

The implementation reports descriptive behaviour only. It does not claim
causality, predict future returns, or treat historical prices as current market
data.

## Personas

Personas are immutable versions tied to one Trading DNA snapshot. The initial
deterministic classifier supports `scalper`, `intraday`, `swing`, `trend`,
`mean_reversion`, `hybrid` and `unclassified`. A classified persona needs at
least five supported observations and must cite the holding, timeframe and/or
strategy evidence that selected it. Insufficient evidence produces
`unclassified` with zero confidence.

## Reports and analytics

The same immutable snapshot renders as JSON, escaped HTML and a bounded PDF.
Reports contain strengths, weaknesses, patterns, risk, strategy, confidence and
improvement sections; no LLM expands or invents conclusions. Analytics expose
behaviour, strategy, confidence, drawdown, risk, symbol, timeframe and monthly
evolution over snapshot versions.

Authenticated application routes are read-only:

- `GET /api/trading-dna`
- `GET /api/trading-dna/analytics`
- `GET /api/trading-dna/report?format=json|html|pdf`

Snapshot generation is an internal server operation through
`generateTradingDnaSnapshot()`. It writes only derived immutable records.

## Retention and deletion

Snapshot, persona and shadow records are append-only. Account deletion cascades
through the tenant-owned derived records. Source retention/deletion remains
owned by the Phase 1/4 systems and Research Service.
