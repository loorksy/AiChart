# أوامر الوكيل + بطاقات تيليجرام + صرف طبيعي

> **الحالة:** منفّذ (build محلي؛ VPS عبر tar/scp)  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/agent_commands_telegram_ui_ac745e8b.plan.md`](./originals/agent_commands_telegram_ui_ac745e8b.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| حدود توكن | `maxTokens` 16384، إزالة `contextPruning`، quota اختياري |
| حساب + سبريد | `accountProfile.ts`, `spread.ts`, في `risk/status` |
| إدارة صفقات | `intentRevalidate`, `trade/evaluate`, `trade/exit-decision` |
| بطاقات | `telegramCards.ts` — فاصل `─────────────────` + «X دولار» |
| أزرار أوامر | `telegramCommands.ts` — `cmd:*` → نص للوكيل |
| bridge | `agent/scripts/telegram-cmd-bridge.sh` |

## قرار معماري

**كل زر = أمر للوكيل** — OpenClaw يستقبل `[CMD:…]` وينفّذ عبر Bridge API، لا استدعاء API مباشر من callback.

## قائمة مهام

- [x] token-unlimit
- [x] account-profile-api
- [x] position-management
- [x] telegram-cards-cmds
- [x] openclaw-skill-docs
- [x] deploy-verify
