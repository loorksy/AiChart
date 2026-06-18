# دمج OpenClaw Control UI (`/openclaw/`)

> **الحالة:** منفّذ + نُشر على VPS  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/openclaw_ui_embed_c583eb27.plan.md`](./originals/openclaw_ui_embed_c583eb27.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| Reverse proxy | `https://aichart.lork.cloud/openclaw/` (nginx + WebSocket) |
| openclaw.json | `controlUi.enabled`, `basePath=/openclaw`, `allowedOrigins` |
| Admin API | `GET /api/admin/openclaw-console` |
| واجهة AiChart | `/agent/console` — أزرار فتح اللوحة |
| سكربتات | `infra/vps-openclaw-control-ui.sh`, `infra/nginx/` |

## الهدف

وصول الأدمن إلى **Control Web UI الكامل** لـ OpenClaw على نفس الدomain — دون إعادة بناء الإعدادات داخل AiChart.

## قائمة مهام

- [x] openclaw-config
- [x] nginx-proxy
- [x] admin-api
- [x] console-page
- [x] env-docs
- [x] vps-deploy
