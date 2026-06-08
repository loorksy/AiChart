# AiChart

منصة تداول ذكية متعددة المستخدمين على **Binance**، يتحدث فيها كل متداول مع وكيل خبير
يراقب السوق بصبر ويتحرّك فقط عند الفرصة المناسبة — صفقة أو توصية، حسب اختيار المستخدم.

> راجع خطة المشروع الكاملة في [`docs/PLAN.md`](docs/PLAN.md).

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

## المراقبة 24/7 (المرحلة 6)

طبقة المراقبة الرخيصة (`monitor.ts`) تفحص الأصول كل 15 دقيقة. Claude يُستدعى **فقط** عند ظهور إشارات فنية.

```bash
# مثال — استدعاء دورة المراقبة
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain/api/cron/monitor

# ملخّص يومي لتليجرام
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-domain/api/cron/daily-summary
```

انظر [`infra/crontab.example`](infra/crontab.example) لجدولة cron على لينكس.

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
