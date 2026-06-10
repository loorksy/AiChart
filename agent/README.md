# AiChart Agent — OpenClaw

الوكيل الحي للمنصة: [OpenClaw](https://openclaw.ai) يدير المحادثة (Telegram)،
النبض الدوري (heartbeat)، والذاكرة — ويتداول فعلياً عبر Bridge API الخاص
بالمنصة (`web` → `/api/agent/*`) خلف Risk Guard.

```
OpenClaw (الدماغ + تيليجرام + heartbeat + ذاكرة)
        │  مهارة aichart-trading → HTTP + توكن
        ▼
AiChart web — Bridge API → Risk Guard → Binance / MetaTrader
```

## الإعداد

1) ثبّت OpenClaw على الخادم:

```bash
npm install -g openclaw
openclaw onboard        # اربط Anthropic API key وقناة Telegram (توكن البوت)
```

2) عرّف متغيرات البيئة للوكيل (في `~/.openclaw/openclaw.json` أو بيئة الخدمة):

```bash
AICHART_API_URL=http://localhost:3000
AICHART_SERVICE_TOKEN=...   # نفس القيمة المعرفة في web/.env
```

3) انشر ملفات المعرفة (تُكرر بعد كل تعديل في `agent/workspace/`):

```bash
bash agent/scripts/sync-workspace.sh
```

4) شغّل البوابة:

```bash
openclaw gateway          # أو عبر pm2/docker — راجع infra/
```

## الملفات

| الملف | الدور |
|---|---|
| `workspace/SOUL.md` | الشخصية والمبادئ |
| `workspace/AGENTS.md` | قواعد التشغيل والأوضاع الثلاثة (auto/approval/direct) |
| `workspace/USER.md` | تفضيلات المشغّل |
| `workspace/HEARTBEAT.md` | مهام النبض الدوري (متابعة الصفقات، مسح الفرص، الملخص اليومي) |
| `workspace/MEMORY.md` | بذرة الذاكرة الدائمة (الوكيل يملكها بعد أول مزامنة) |
| `workspace/skills/aichart-trading/SKILL.md` | تعريف الوكيل بـ Bridge API |
| `scripts/sync-workspace.sh` | نشر الملفات إلى `~/.openclaw/workspace` |

> حالة التشغيل (اليوميات `memory/`، الجلسات، الإعدادات) تعيش في
> `~/.openclaw/` ولا تدخل git أبداً. لا تضع أي توكن داخل ملفات workspace.
