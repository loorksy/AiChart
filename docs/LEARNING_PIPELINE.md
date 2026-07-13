# Recommendation Learning Pipeline

## Evidence boundary

Learning starts only after a canonical recommendation outcome is appended. Chat text, generated
prose, current prices and browser state are not learning evidence. Outcome append is tenant scoped
and idempotent through a recommendation-local evidence key.

Stored outcome evidence supports:

```text
TP1 / TP2 / TP3 / SL / BreakEven / Trailing / ManualClose
Expired / Cancelled / Invalidated
```

Each record may include R multiple, PnL, holding time, MAE, MFE, spread, slippage, commission and
risk used. Missing measurements stay missing; the pipeline does not invent them.

## Deterministic events

| Outcome | Learning event |
|---|---|
| TP1, TP2 | `PartialTargetHit` |
| TP3 | `FinalTargetHit`, `RecommendationSucceeded` |
| SL | `RecommendationFailed` |
| BreakEven | `BreakEvenReached` |
| Trailing | `TrailingActivated` |
| Expired | `RecommendationExpired` |
| Cancelled | `RecommendationCancelled` |
| Invalidated | `RecommendationInvalidated` |

Manual close remains outcome evidence but is not called success/failure without an explicit
validated result. Event IDs are deterministic from recommendation/outcome/type and are append-only.

## Trade Lesson candidates

Candidates are grouped by tenant, strategy, market, direction and dominant validated result. The
default gates are a minimum sample of five and confidence of 0.65. Confidence combines the dominant
result ratio with the source-recommendation confidence. A stable fingerprint prevents duplicates;
new evidence refreshes an unvalidated candidate rather than creating a second lesson.

Every candidate contains reason, event IDs as supporting evidence, strategy, market, confidence,
sample size and affected symbols. Validation is explicit. `listValidatedTradeLessons()` returns
only validated records and is the Phase 4 adapter for future recall; automatic model-authored
lesson promotion is not permitted.

## Analytics

Analytics use canonical rows and outcome records only. They produce win/loss rate, average R,
profit factor, expectancy, average holding time, MAE and MFE, grouped by symbol, timeframe,
strategy, confidence band, session, exit reason, entry type, month and day. No chat classifications
or mutable UI fields participate.

## Failure and security behavior

Outcome/history writes are database evidence operations, not execution operations. They cannot
open or modify a trade. Learning modules have no Risk Guard, Execution Guard, Market Sync Guard or
broker imports. A lesson or weight version cannot grant permissions or change risk limits.
