# ربط البوت + أوامر عربية + Reply Keyboard

> **الحالة:** منفّذ + نُشر على VPS  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/arabic_telegram_keyboard_42dcd7c3.plan.md`](./originals/arabic_telegram_keyboard_42dcd7c3.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| ربط التوكن | `agent/scripts/sync-telegram-bot.sh` |
| تشخيص | `infra/vps-telegram-bot-health.sh` |
| أوامر `/` عربية | `commands.native: false` + `customCommands` + `telegram-setup-ar-commands.sh` |
| مصدر واحد | [`web/src/lib/telegram-ar-commands.json`](../../web/src/lib/telegram-ar-commands.json) |
| Reply Keyboard | `sendMessageWithReplyKeyboard` + `POST /api/agent/telegram/menu` |
| مزامنة LLM | `agent/scripts/sync-openclaw-auth.sh` (Anthropic → OpenClaw auth) |
| reconnect | `infra/vps-openclaw-telegram-reconnect.sh` |

## أسباب «البوت لا يرد» (مُوثّقة)

1. `botToken` غير مزامن في `openclaw.json`
2. webhook نشط (يجب polling + `deleteWebhook`)
3. مفتاح Anthropic غير في OpenClaw auth store
4. `sync-model` يزيل `anthropic-messages` → 401 صامت
5. `AI_MODEL=claude-opus-4-6` بدون كatalog صالح

## أوامر `/` (وصف عربي)

`qaima`, `tahil`, `rased`, `safaqat`, `iadadat`, `crypto`, `forex`, `demo`, `live`

## قائمة مهام

- [x] bot-connectivity
- [x] disable-native-cmds
- [x] reply-keyboard-api
- [x] agent-docs-mapping
- [x] vps-deploy

## سكربتات التحقق

```bash
bash infra/vps-telegram-bot-health.sh
bash agent/scripts/sync-openclaw-auth.sh anthropic
bash infra/vps-openclaw-telegram-reconnect.sh
```
