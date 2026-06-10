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

## الرسائل الصوتية (تيليجرام)

Claude لا يفرّغ الصوت — بدون مزوّد تفريغ تصل الرسالة الصوتية للوكيل فارغة.
فعّل خط الصوت في `~/.openclaw/openclaw.json`:

```json5
{
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [
          // يتطلب OPENAI_API_KEY في بيئة الوكيل (مثلاً ~/.openclaw/.env)
          { provider: "openai", model: "gpt-4o-mini-transcribe" },
          // أو بديل محلي بلا API: pip install -U openai-whisper
          // { type: "cli", command: "whisper", args: ["--model", "base", "{{MediaPath}}"], timeoutSeconds: 45 },
        ],
      },
    },
  },
}
```

ثم أعد التشغيل **بإيقاف كامل** (تعديلات config متكررة قد تترك خط الصوت
بحالة معطلة بعد restart عادي):

```bash
pm2 stop aichart-agent && sleep 5 && pm2 start aichart-agent
```

ملاحظات: حدّث OpenClaw إن كان أقدم من `2026.4.11` (ثغرات معروفة في صوتيات
تيليجرام)، والصوتيات الأقصر من ثانية (~1KB) تُتخطى عمداً كفارغة.

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
