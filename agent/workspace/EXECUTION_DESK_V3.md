# Lonora Execution Desk

The execution desk does not decide the market side. It receives an AI-selected BUY/SELL candidate and performs technical order safety only.

Required before sending an order:

- explicit operator approval;
- execution permission;
- connected Forex broker account and fresh heartbeat;
- open Forex session and fresh quote with acceptable spread;
- real broker equity and symbol contract metadata;
- mandatory stop-loss with valid side geometry;
- server-calculated volume from Risk per Trade and stop distance, rounded down to broker step.

An execution failure blocks only the order. It does not change the recommendation to WAIT or flip direction. Never accept lots, notional, leverage, or balance overrides from chat/tool input.
