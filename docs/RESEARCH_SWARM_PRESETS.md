# Research Swarm presets and roles

Presets are reviewed server code. A caller selects a name and bounded parameters; it cannot submit a graph, role, tool permission, prompt, module, path, URL, or code.

| Preset | Required path | Optional work | Policy |
| --- | --- | --- | --- |
| `gold_strategy_lab` | market → strategy → risk → synthesis | backtest → validation | partial |
| `forex_research_committee` | market, strategy, risk, synthesis | none | fail-fast |
| `strategy_validation_team` | strategy → backtest → validation → risk → synthesis | none | fail-fast |
| `risk_review_committee` | strategy → risk → synthesis | Trading DNA | partial |
| `performance_attribution_team` | attribution → risk → synthesis | Trading DNA | partial |
| `shadow_trader_review` | shadow review → risk → synthesis | Trading DNA | partial |
| `weekly_market_research` | market → strategy/risk → synthesis | attribution | partial |

Synthesis is always present and waits for all other tasks to terminate. Bounded parameter validation cannot change policy.

| Role | Purpose | Reviewed tools | Default |
| --- | --- | --- | --- |
| `market_researcher` | market evidence | market/multi-timeframe snapshot | required |
| `strategy_analyst` | strategy evidence | recommendation/lesson reads | required |
| `backtest_analyst` | deterministic backtest evidence | backtest/artifact reads | optional |
| `validation_analyst` | deterministic validation evidence | validation/artifact reads | optional |
| `risk_reviewer` | research risk | recommendation/lesson reads | required |
| `performance_attribution_analyst` | descriptive attribution | analytics/artifact reads | required |
| `trading_dna_analyst` | Trading DNA evidence | DNA/lesson reads | optional |
| `shadow_trader_analyst` | research-only shadow evidence | shadow/recommendation reads | optional |
| `synthesis_agent` | organize without recalculation | none | required |

Reviewed skills are limited to AiChart lexicon, strategy, risk, recommendation, and gold-analysis material. A skill cannot add tools or increase authority. Every tool list is validated against a closed research registry. Trade execution/management, chart writes, shell, subprocess, broker, MT5, arbitrary HTTP/file/database access, and dynamic Python are forbidden.
