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

## الرسائل الصوتية (تيليجرام) — عبر OpenRouter

Claude لا يفرّغ الصوت — بدون مزوّد تفريغ تصل الرسالة الصوتية للوكيل فارغة.

التفريغ يمر عبر **منصة AiChart نفسها**: مفتاح OpenRouter ونموذج الصوت
يُضبطان من **لوحة الأدمن → المفاتيح → «الصوت — OpenRouter»** (أدخل المفتاح،
اضغط «جلب النماذج»، اختر نموذجاً يدعم الصوت مثل
`google/gemini-2.5-flash`، ثم «حفظ المفاتيح»).

ثم وجّه OpenClaw لخط التفريغ في `~/.openclaw/openclaw.json`:

```json5
{
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [
          {
            type: "cli",
            command: "bash",
            args: [
              "-c",
              "curl -sf -H \"Authorization: Bearer $AICHART_SERVICE_TOKEN\" -F \"file=@$1\" \"${AICHART_API_URL:-http://localhost:3000}/api/agent/transcribe\"",
              "_",
              "{{MediaPath}}",
            ],
            timeoutSeconds: 90,
          },
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

## أمان الخادم المشترك (مشاريع أخرى على نفس الـ VPS)

الوكيل ممنوع من لمس أي شيء خارج عمله إلا بموافقة صريحة — على طبقتين:

**1. قواعد صلبة في `AGENTS.md`** (مُضمّنة): لا ملفات ولا خدمات خارج
workspace والجسر؛ أي أمر آخر يتطلب إذناً صريحاً في المحادثة.

**2. فرض تقني عبر Exec Approvals في OpenClaw** — لأن exec على الـ gateway
يعمل افتراضياً بصلاحية كاملة بلا أسئلة. قيّده بالملفين معاً (الأشد يفوز):

```json5
// ~/.openclaw/openclaw.json
{
  tools: {
    exec: { security: "allowlist", ask: "on-miss" },
  },
}
```

```json
// ~/.openclaw/exec-approvals.json
{
  "version": 1,
  "defaults": { "security": "allowlist", "ask": "on-miss", "askFallback": "deny" }
}
```

بعدها أي أمر غير مُدرج في القائمة البيضاء يرسل لك **طلب موافقة** قبل
التنفيذ — وافق على أوامر `curl` الخاصة بالجسر مع «السماح دائماً» في أول
مرة لتُدرج في القائمة ولا يسألك عنها مجدداً. ثم أعد تشغيل البوابة
بإيقاف كامل.

> عزل مطلق بديل: شغّل الوكيل عبر خدمة `agent` في
> `infra/docker-compose.yml` — داخل حاوية لا يرى ملفات الخادم أصلاً.

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
