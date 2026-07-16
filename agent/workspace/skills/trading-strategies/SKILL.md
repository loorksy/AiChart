---
name: trading-strategies
version: 2.0.0
category: analysis
riskLevel: analysis
supportedLocales: ["ar", "en"]
allowedMarkets: ["forex"]
tags: ["forex", "scalping", "structure", "momentum", "liquidity"]
description: Evidence catalogue for Forex scalping analysis; never a deterministic decision engine.
---

# Forex Scalping Evidence Catalogue

Use these dimensions as evidence for the model's BUY, SELL, or WAIT choice:

- Regime and structure: trend, range, transition, breaks, and reversals.
- Entry context: support/resistance, supply/demand, liquidity, imbalance, and volatility bands.
- Confirmation context: candles, momentum, volume, and lower/higher timeframe relationships.
- Level construction: structural invalidation stop and technically supported target levels.

Do not count confluences, require a fixed combination, impose a minimum R:R, alter Risk per Trade, or automatically block a side. Higher timeframes, sessions, news, and spread remain evidence. Position sizing occurs only after the model decision through the server's Risk per Trade calculation.
