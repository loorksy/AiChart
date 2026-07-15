# AiChart

منصة تداول ذكية متعددة المستخدمين على **الفوركس والذهب (OANDA بيانات + MT5/EA تنفيذ)**، يتحدث فيها كل متداول مع
وكيل خبير يراقب السوق بصبر ويتحرّك فقط عند الفرصة المناسبة — توصية أو صفقة بعد موافقة صريحة.

الهوية القانونية للوكيل (الدستور): [`agent/workspace/SYSTEM.md`](agent/workspace/SYSTEM.md) — مصدر واحد
تُشتق منه تعليمات الويب وMCP معاً. كتالوج المهارات: [`agent/workspace/skills/`](agent/workspace/skills/) —
يكتشفه الويب (`skillRegistry`) وMCP (`list_agent_skills` / `load_agent_skill`) من نفس الملفات.
العقد القانوني للأدوات: [`agent/tools/contract.json`](agent/tools/contract.json) (مولَّد — `npm run contract:export` في `mcp/`).

## المكوّنات

| المجلد | المحتوى |
|--------|---------|
| [`web/`](web) | تطبيق Next.js كامل: الواجهة + `/api/*` + وكيل الشارت الذكي + Risk Guard + مستودع الشموع |
| [`mcp/`](mcp) | خادم MCP بعيد (Claude Connectors) — 59 أداة + مهارات + موارد |
| [`agent/`](agent) | حزمة المحتوى القانوني: الدستور، المهارات، bootstrap، عقد الأدوات |
| [`research-service/`](research-service) | خدمة أبحاث Python معزولة: باكتيست حتمي، تحقق إحصائي، Research Swarm |
| [`ea/`](ea) | MetaTrader Expert Advisors (جسر التنفيذ) |
| [`infra/`](infra) | نشر: PM2 + Docker Compose + nginx + سكربتات VPS |
| [`docs/`](docs) | توثيق المعمارية والتشغيل |

## التشغيل المحلي

```bash
cd web
npm install
cp .env.example .env   # ثم املأ القيم
npm run dev            # http://localhost:3010
```

### متغيرات البيئة الأساسية

| المتغيّر | الوصف |
|----------|-------|
| `ENCRYPTION_KEY` | مفتاح 32 بايت (64 hex) لتشفير أسرار الوسطاء. `openssl rand -hex 32` |
| `APP_SECRET` | سرّ توقيع الجلسات. `openssl rand -base64 48` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | حساب الأدمن المُنشأ تلقائياً عند أول تشغيل |
| `DB_PATH` / `DATABASE_URL` | SQLite محلياً · PostgreSQL في الإنتاج |
| `OPENAI_API_KEY` | مفتاح مزوّد الذكاء للوكيل |
| `OANDA_API_TOKEN` / `OANDA_ACCOUNT_ID` | مصدر بيانات الفوركس/الذهب الوحيد |
| `TELEGRAM_BOT_TOKEN` | (اختياري) بوت تليجرام للإشعارات |
| `CRON_SECRET` | (إنتاج) سرّ لحماية مهام المراقبة والملخّص اليومي |

القائمة الكاملة مع الشرح: [`web/.env.example`](web/.env.example) · تشغيل إنتاجي: [`docs/PRODUCTION_OPERATIONS.md`](docs/PRODUCTION_OPERATIONS.md) · CI والنشر: [`CI_AND_DEPLOYMENT.md`](CI_AND_DEPLOYMENT.md)

## Claude MCP — التداول من Connectors

MCP Server في [`mcp/`](mcp/) يغلّف Bridge API للربط مع **Claude.ai → Customize → Connectors**.

| الحقل | القيمة |
|-------|--------|
| Remote MCP server URL | `https://aichart.lork.cloud/mcp` |

```bash
cd mcp && npm install && npm run build
bash infra/vps-mcp-deploy.sh /opt/aichart
```

عند التهيئة يقرأ العميل التعليمات الأساسية من `SYSTEM.md` تلقائياً، ثم يكتشف المهارات عبر
`list_agent_skills` ويحمّل ذات الصلة فقط عبر `load_agent_skill` — المورد المرئي لا يُعتبر مهارة محمّلة.

## المراقبة — صيانة ميكانيكية

Cron (`monitorRunner.ts`) يشغّل صيانة OCO/journal كل 10 دقائق — **بدون استيقاظ وكيل**.
قرارات التداول في محادثة الوكيل. انظر [`agent/`](agent/README.md).

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
# PM2 (المسار الإنتاجي الحالي)
bash infra/deploy-vps.sh            # أول مرة
bash infra/vps-pull-deploy.sh       # تحديثات لاحقة

# Docker Compose (بديل كامل)
GIT_COMMIT=$(git rev-parse HEAD) docker compose -f infra/docker-compose.yml up -d --build
```

هوية الإصدار: `/api/healthz` يعرض `version` و`commit` للنسخة العاملة فعلياً، و`/health` في MCP كذلك.

## التحقق (Validation)

```bash
cd web && npm run lint && npm run test:ci && npm run build
cd mcp && npm run typecheck && npm run test:catalog && npm run schemas:check
cd research-service && pip install -e ".[dev]" && pytest
```

## التقنيات

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · PostgreSQL/SQLite · OpenAI · OANDA · MT5/EA · Telegram Bot API · TradingView Charts · FastAPI (أبحاث)

---

تنبيه: للأغراض التعليمية. التداول ينطوي على مخاطر عالية. ابدأ دائماً ببيئة **تجريبية (Demo)**.
