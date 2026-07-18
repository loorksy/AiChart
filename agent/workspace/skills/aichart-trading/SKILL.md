---
name: aichart-trading
version: 2.0.0
category: execution
riskLevel: execution
requiredTools: ["get_trade_readiness", "open_trade"]
supportedLocales: ["ar", "en"]
allowedMarkets: ["forex"]
tags: ["execution", "trade", "mt5", "approval", "scalping"]
description: Execute an AI-generated Forex scalp plan through AiChart's technical broker safety flow.
---

# AiChart Trading

The model is the sole authority for BUY, SELL, or WAIT. Use fresh market tools to generate BUY/SELL entry, mandatory stop-loss, and target levels; technical validation may reject execution but never select or rewrite direction.

Before execution:

1. Call `get_trade_readiness` for technical authorization, connection, session, heartbeat, quote freshness, and spread.
2. Obtain explicit operator approval.
3. Call `open_trade` with symbol, side, real levels, rationale, recommendation id when available, and `approved_by_user:true`.

Never pass lots, notional, leverage, futures fields, or balance overrides. The server calculates volume from verified broker equity, Risk per Trade, stop distance, tick value/size, and broker step, rounded down. A technical rejection blocks the order only and must not rewrite the AI recommendation.
