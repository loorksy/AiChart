# جسر بث مباشر — Live Account Bridge

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/live_account_bridge_b1fc8b91.plan.md`](./originals/live_account_bridge_b1fc8b91.plan.md)

---

## نتيجة التنفيذ

| المرحلة | النتيجة |
|---------|---------|
| Phase 0 — off quotes / retry 10026 | EA `WaitForLiveQuotes` + `resolveMt5Symbol` |
| Phase 1 — live stream | `POST /api/ea/quotes`, `eaLiveState`, `GET /api/agent/live/account` |
| Phase 2 — أوامر كاملة | pending, partial close, cancel, query terminal |
| Phase 3 — MCP tools | live account, diagnostics, chart capture |
| Phase 4 — Binance live | WS/poll في live/account |
| Phase 5 — deploy | EA v3 + VPS |

## الهدف

Claude يرى حساب MT5/Binance **لحظياً** وينفّذ أوامر بشرية كاملة ضمن Risk Guard.

## قائمة مهام

- [x] phase0-off-quotes
- [x] phase1-live-stream
- [x] phase2-full-commands
- [x] phase3-mcp-tools
- [x] phase4-binance-live
- [x] phase5-deploy-test
