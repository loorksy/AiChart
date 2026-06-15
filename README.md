# AiChart

منصة تداول ذكية متعددة المستخدمين على **Binance**، يتحدث فيها كل متداول مع وكيل خبير
يراقب السوق بصبر ويتحرّك فقط عند الفرصة المناسبة — صفقة أو توصية، حسب اختيار المستخدم.

> راجع خطة المشروع الكاملة في [`docs/PLAN.md`](docs/PLAN.md).  
> دليل شامل بالعربية (صفحات، وكيل، تليجرام، إعدادات): [`docs/PROJECT_AR.md`](docs/PROJECT_AR.md).  
> اقتراحات قابلة للتنفيذ (فجوات الكود مقابل الخطة): [`docs/SUGGESTIONS_FEASIBLE.md`](docs/SUGGESTIONS_FEASIBLE.md).

## الحالة الحالية: المراحل 1–6 مكتملة

تطبيق **Next.js** كامل (واجهة + API) في مجلد [`web/`](web):

| المرحلة | المحتوى |
|---------|---------|
| **1** | تسجيل دخول، مفاتيح Binance مشفّرة، إعدادات، صفحة أدمن |
| **2** | دردشة الوكيل + توصيات (Claude + Binance Skills Hub) |
| **3** | شارت حي (شموع + إشارات) |
| **4** | تنفيذ صفقات، Risk Guard، Kill Switch |
| **5** | بوت تليجرام (ربط، أزرار موافقة، أوامر، ثنائي اللغة) |
| **6** | مراقبة 24/7، سكرين شوت، ملخّص يومي، onboarding، أمن، نشر |

## التشغيل المحلي

```bash
cd web
npm install
cp .env.example .env   # ثم املأ القيم
npm run dev            # http://localhost:3000
```

### متغيرات البيئة المطلوبة

| المتغيّر | الوصف |
|----------|-------|
| `ENCRYPTION_KEY` | مفتاح 32 بايت (64 hex) لتشفير أسرار Binance. `openssl rand -hex 32` |
| `APP_SECRET` | سرّ توقيع الجلسات. `openssl rand -base64 48` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | حساب الأدمن المُنشأ تلقائياً عند أول تشغيل |
| `DB_PATH` | مسار قاعدة SQLite (افتراضي `data/aichart.db`) |
| `ANTHROPIC_API_KEY` | مفتاح Claude للوكيل |
| `TELEGRAM_BOT_TOKEN` | (اختياري) بوت تليجرام للإشعارات |
| `CRON_SECRET` | (إنتاج) سرّ لحماية مهام المراقبة والملخّص اليومي |

## Claude MCP — التداول من Connectors

بديل/مكمّل لـ OpenClaw: MCP Server في [`mcp/`](mcp/) يغلّف Bridge API للربط مع **Claude.ai → Customize → Connectors**.

| الحقل | القيمة |
|-------|--------|
| Remote MCP server URL | `https://aichart.lork.cloud/mcp` |

دليل كامل: [`docs/MCP_CLAUDE_SETUP.md`](docs/MCP_CLAUDE_SETUP.md) · إيقاف OpenClaw: [`docs/OPENCLAW_DECOMMISSION.md`](docs/OPENCLAW_DECOMMISSION.md)

```bash
cd mcp && npm install && npm run build
bash infra/vps-mcp-deploy.sh /opt/aichart
```

## المراقبة 24/7 — Event-Driven

الكود (`monitorRunner.ts` + `monitor.ts`) يفحص السوق والصفقات كل 10 دقائق
عبر cron — **بدون AI**. عند حدث (مرشح فني، اقتراب SL/TP، خسارة يومية) تُرسل
رسالة `[EVENT:…]` لتيليجرام فيستيقظ OpenClaw. انظر [`agent/`](agent/README.md).

```bash
# مراقبة بالأحداث (كل 10 دقائق)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain/api/cron/event-monitor

# ملخّص يومي + تحديث ذاكرة (مرة/يوم)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain/api/cron/daily-summary
```

## النشر على خادم لينكس

```bash
# PM2
cd web && npm run build
pm2 start ../infra/pm2.ecosystem.config.cjs

# Docker
docker compose -f infra/docker-compose.yml up -d

# systemd
sudo cp infra/aichart.service /etc/systemd/system/
sudo systemctl enable --now aichart
```

## التقنيات

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · SQLite · Claude (Anthropic) · Binance Skills Hub · Telegram Bot API · Lightweight Charts

> ملاحظة: استُخدمت **SQLite** للتشغيل المحلي البسيط. الخطة تنصّ على **PostgreSQL** للإنتاج الكبير — يمكن الترحيل لاحقاً.

---

تنبيه: للأغراض التعليمية. التداول ينطوي على مخاطر عالية. ابدأ دائماً ببيئة **Testnet**.
