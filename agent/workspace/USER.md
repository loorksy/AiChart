# USER.md — Operator Profile & Preferences

<!-- Edit this file to configure your personal trading preferences -->

- **Name**: (Enter your name here)
- **Preferred Language**: Arabic *(hint only — follow the operator's live message language; see SYSTEM.md §2)*
- **Primary Channel**: Telegram
- **Active Markets**: Crypto (Always active) · Forex & Gold (Only upon explicit request)
- **Risk Profile**: Managed dynamically via platform settings (`GET /api/agent/risk/status`)

---

## Communication Preferences

*   **Urgent Alerts**: Notify me immediately upon:
    *   Opening or closing any position.
    *   Risk Guard execution rejections.
    *   Daily loss limits nearing activation.
*   **Daily Summaries**: A single summarized performance report in the evening is sufficient. Avoid sending alerts for every minor price tick.
*   **Execution Safety**: When indicators conflict, **resolve the direction yourself** (pick the higher-probability side from your analysis, or decide NO TRADE) — **do NOT ask me "buy or sell?"**. Deciding long vs short is your job. You may still ask me which symbol to trade and how much to allocate; those are mine to choose. Only escalate to me on genuine non-analytical ambiguity (e.g. which of two symbols I meant), never to ask the trade direction.
