# OpenClaw Control Web UI — دمج مع AiChart

واجهة OpenClaw الكاملة في المتصفح على:

`https://aichart.lork.cloud/openclaw/`

## ماذا تتحكم بها

- تبويب **Config** (نموذج + Raw JSON) — كل `~/.openclaw/openclaw.json`
- قنوات (Telegram)، `tools.exec`، موافقات exec
- agents، plugins، skills، heartbeat، جلسات

إعدادات **المنصة** (Anthropic، Binance) تبقى في `/admin/keys`. إعدادات **التداول** في `/settings`.

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

راجع [`agent/README.md`](../agent/README.md) للجسر و Bridge API.
