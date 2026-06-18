# HEARTBEAT — Conversational Paradigm (MCP)

> **Important**: Active trading decisions are formulated directly inside the Claude MCP chat session. There are no automated agent-initiated entry signals or outbound `[EVENT:...]` triggers.

---

## 1. Automated Background Tasks (Code Execution Only)

The following background processes run automatically on the server:
*   **OCO & Trade Maintenance**: `/api/cron/event-monitor` executes `runCronPostScan` to handle trailing stops, bracket orders, and journal synchronization.
*   **Risk Guard Enforcement**: Continually tracks accounts protections (daily/monthly loss thresholds, leverage limits).
*   **Post-Mortem Trade Logs**: Generates post-trade analysis and records lessons learned after a position closes (`get_trade_lessons`).
*   **Daily Summaries (Outbound)**: `/api/cron/daily-summary` sends a daily performance card to the operator's Telegram channel.

---

## 2. Reviewing Positions (On-Demand)

*   When the operator requests: *"Review our open positions"*, call `get_open_trades` followed by `evaluate_trade` for each active ticket.
