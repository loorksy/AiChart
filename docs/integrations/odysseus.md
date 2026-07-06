# Odysseus × AiChart Integration

This is the first implementation slice for embedding AiChart inside Odysseus as a trading workspace while keeping Odysseus as the primary application.

## Goal

Odysseus opens an AiChart TradingView Advanced Charting Library panel from inside the agent conversation. AiChart remains responsible for:

- OANDA server-side forex market data.
- TradingView chart rendering and drawings.
- OpenAI-backed market analysis.
- MetaTrader 5 EA bridge execution through Risk Guard.
- Trade recommendations, history, and emergency-stop controls.

## Bootstrap endpoint

AiChart now exposes a public manifest for Odysseus:

```text
GET /api/integrations/odysseus/manifest
```

The manifest advertises:

- the default embeddable chart URL;
- supported modes: `manual`, `semi_auto`, `full_auto`;
- the required Odysseus chat surfaces;
- tool descriptors for OANDA instruments, candles, market analysis, recommendations, MT5 execution, and emergency stop.

## Chat embed contract

Odysseus should render the chart inside the active conversation when the agent calls its chart-open action. The generated URL uses this format:

```text
/chart/{SYMBOL}?embed=odysseus&interval={INTERVAL}&source=oanda
```

Optional query parameters:

- `conversationId` — Odysseus conversation identifier.
- `recommendationId` — AiChart recommendation identifier, when reopening a setup.

## Execution modes

- `manual`: recommendation only.
- `semi_auto`: agent prepares the order; the user must press Execute.
- `full_auto`: agent may execute through Risk Guard after the user enables this mode.

## Safety notes

Full-auto must remain behind user settings, emergency stop, fresh quote checks, and MT5 bridge readiness checks. Vision is report-only and must not be the primary execution signal.

## Next slice

Once the Odysseus source tree is available locally, wire this manifest into Odysseus' chat UI and mount the embed panel in the assistant message renderer.
