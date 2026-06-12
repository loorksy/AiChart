# OpenClaw Control Web UI — دمج مع AiChart

واجهة OpenClaw الكاملة في المتصفح على:

`https://aichart.lork.cloud/openclaw/`

## ماذا تتحكم بها

- تبويب **Config** (Raw JSON، قنوات، exec، plugins) — **ليس** لتغيير النموذج
- قنوات (Telegram)، `tools.exec`، موافقات exec
- agents، plugins، skills، heartbeat، جلسات

### النموذج (Gemini / Claude / …)

**المصدر الوحيد:** [`/console/platform`](/console/platform) (لوحة المفاتيح → الذكاء الاصطناعي).

- اختر المزود والنموذج واحفظ — يُشغَّل `syncOpenClawModelFromPlatform` ويُحدَّث `~/.openclaw/openclaw.json`.
- **لا تغيّر Model** من Quick Settings أو تبويب Config في OpenClaw — التغيير اليدوي يُبقي نماذج قديمة ويُفسد المزامنة.
- Quick Settings قد تعرض **default** — هذا يعني استخدام `agents.defaults.model.primary` من المنصة (مثل `google/gemini-2.5-flash`)، وليس نموذجاً مختلفاً.
- بعد الحفظ من المنصة: أعد تحميل لوحة OpenClaw أو ابدأ جلسة Telegram جديدة.

إعدادات **المفاتيح الأخرى** (Binance، Telegram token) تبقى في `/console/platform`. إعدادات **التداول** في `/settings`.

## الدخول

1. سجّل دخولك كـ **admin** في AiChart
2. **الوكيل** → **فتح اللوحة** أو `/agent/console`
3. اضغط **فتح لوحة OpenClaw** (يمرّر token تلقائياً)

لا تستخدم iframe — افتح الصفحة مباشرة.

## النشر على VPS

```bash
cd /opt/aichart
bash infra/vps-openclaw-control-ui.sh
```

ثم أضف [`infra/nginx/aichart-openclaw.conf`](../infra/nginx/aichart-openclaw.conf) داخل vhost nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

متغيرات في `web/.env`:

```env
OPENCLAW_CONSOLE_URL=https://aichart.lork.cloud/openclaw/
OPENCLAW_GATEWAY_TOKEN=<نفس gateway.auth.token في openclaw.json>
```

## استكشاف الأخطاء

| العرض | الحل |
|-------|------|
| 502 على `/openclaw/` | `pm2 restart aichart-agent` — تحقق أن Gateway على 18789 |
| WebSocket فشل | تأكد من `Upgrade` في nginx |
| Origin مرفوض | `allowedOrigins` يجب أن يتضمن `https://aichart.lork.cloud` |
| زر اللوحة معطّل | أضف `OPENCLAW_GATEWAY_TOKEN` في `web/.env` |
| OpenClaw Quick Settings = default | طبيعي — يعني `agents.defaults.model.primary` من `/console/platform` |
| gemma/tts رغم Gemini | احفظ من `/console/platform` — لا من OpenClaw UI |

## Workspace Skills vs Built-in

OpenClaw يحمّل المهارات من مصادر متعددة — **لا تنسخ** الـ 57 Built-in إلى workspace.

| المصدر | المسار | الغرض |
|--------|--------|--------|
| Workspace (أعلى أولوية) | `~/.openclaw/workspace/skills/` | مهارات AiChart المخصّصة فقط |
| Managed / global | `~/.openclaw/skills` | مهارات مشتركة (`openclaw skills install --global`) |
| Bundled | مُرفقة مع التثبيت | تظهر في تبويب **Built-in Skills** — لا نقل |

مهارة AiChart الوحيدة في workspace: `aichart-trading` (Bridge API). تُزامَن من `agent/workspace/skills/` عبر `sync-workspace.sh`.

راجع [`agent/README.md`](../agent/README.md) للتفاصيل.
