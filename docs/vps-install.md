# تثبيت Lonora على VPS

السكربت المعتمد للتثبيت من الصفر هو [`infra/vps-fresh-install.sh`](../infra/vps-fresh-install.sh).
التحديث اللاحق هو [`infra/vps-pull-deploy.sh`](../infra/vps-pull-deploy.sh)، وهو يستدعي
[`infra/vps-ensure-runtime.sh`](../infra/vps-ensure-runtime.sh) قبل إعادة تشغيل pm2.

لا تستخدم `infra/deploy-vps.sh`. ذلك الملف يصف التخطيط القديم (`web/.env` وقاعدة
SQLite) ولا يشغّل حاوية الشارت.

## ماذا يُنشأ

- `/opt/aichart` وتطبيقات pm2: `aichart-web` و`aichart-worker` و`aichart-mcp` فقط
- قاعدة Postgres ودور `aichart` فقط. Redis يُفعَّل إن كان متوقفاً، وملف
  `redis.conf` لا يُمس
- ملف Traefik جديد `/docker/traefik/dynamic/aichart.yml` إن كان المجلد موجوداً
- حاوية Docker باسم `chart-host` على `127.0.0.1:8788`

لا يُثبَّت nginx، ولا تُعدَّل ملفات Traefik الأخرى، ولا تُعاد تشغيل حاويات أو
تطبيقات لا تحمل اسم aichart أو chart-host.

## التثبيت

مكتبة TradingView ليست في git. انسخها إلى المسارين التاليين قبل البناء:

- `public/charting_library/charting_library.standalone.js`
- `src/vendor/tradingview/charting_library/charting_library.d.ts`

ثم على السيرفر كـ root:

```bash
git clone https://github.com/loorksy/AiChart.git /opt/aichart
# انسخ مجلدَي TradingView إلى داخل /opt/aichart كما فوق
bash /opt/aichart/infra/vps-fresh-install.sh
```

كلمة مرور الأدمن المولَّدة تُكتب مرة واحدة في `/root/aichart-admin-bootstrap.txt`
بصلاحية 600. لفرض بريد وكلمة مرور من البداية:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' bash /opt/aichart/infra/vps-fresh-install.sh
```

بعد التثبيت أضف في `/opt/aichart/.env` ثم أعد تشغيل تطبيقات aichart فقط:

- `OPENAI_API_KEY` أو مفتاح Anthropic من لوحة الإعدادات
- `OANDA_API_TOKEN` و`OANDA_ACCOUNT_ID`
- `TELEGRAM_BOT_TOKEN` إن لزم

```bash
pm2 restart aichart-web aichart-worker aichart-mcp --update-env
```

إعادة تشغيل سكربت التثبيت تبقي `.env` الموجود. كلمة مرور دور Postgres
`aichart` تُحفظ في `/root/aichart-db.pass` بصلاحية 600 ولا تُطبع، ولا
تُستبدل إن كان الدور موجوداً. إن وُجد الدور دون هذا الملف يتوقف السكربت.

التحديث بعد أول تثبيت:

```bash
bash /opt/aichart/infra/vps-pull-deploy.sh
```

يبني التطبيق وواجهة الإدارة ثم يستدعي `vps-ensure-runtime.sh` قبل إعادة
تشغيل تطبيقات aichart فقط. لا يعدّل `redis.conf` ولا أي ملف Traefik غير
`aichart.yml`.

## لماذا تفشل لقطة الشارت رغم أن الحاوية تعمل

التبويب الذي يلتقط الشارت يستطلع ذاكرة عملية الويب فقط. التحليل يعمل في
`aichart-worker`. إن غاب أحد المفتاحين يرى العامل أن التبويب لم يستجب ويكتب
«تعذّر التقاط أي شارت» مع أن الحاوية healthy:

| المفتاح | القيمة | إن نقص |
| --- | --- | --- |
| `CHART_HOST_URL` | `http://127.0.0.1:8788` | لا يُفتح التبويب. يُحفظ أيضاً في لوحة الإعدادات (`platform_config`) |
| `AICHART_API_URL` | `http://127.0.0.1:3010` | العامل لا يفوّض الالتقاط إلى عملية الويب |
| `AICHART_SERVICE_TOKEN` | 32 بايت عشوائية على الأقل | الحاوية ترفض الفتح، والصفحة ترفض الرمز |
| `APP_URL` | `https://aichart.lork.cloud` | الحاوية ترفض أي عنوان غير `${APP_URL}/chart-host` |

`vps-ensure-runtime.sh` يملأ المفتاح الناقص فقط ولا يستبدل قيمة موجودة، ويشغّل
الحاوية إن لم تكن healthy. بعد تدوير `AICHART_SERVICE_TOKEN` أعد إنشاء الحاوية
لأنها تحتفظ بالسر الذي بدأت به:

```bash
docker rm -f chart-host
bash /opt/aichart/infra/vps-ensure-runtime.sh
pm2 restart aichart-web aichart-worker --update-env
```

## أعطال التثبيت التي تكررت

- بناء Next يفحص أنواع مجلد `mcp/` فيفشل لأن حزمة MCP مستقلة. الجذر يستثني
  `mcp` من `tsconfig.json`، و`infra/aichart-mcp.sh` يبنيها بـ `npm ci --include=dev`
  حتى لا يحذف `NODE_ENV=production` مترجم TypeScript.
- Flutter يحتاج `unzip` قبل أول تشغيل، وإلا يتوقف استخراج Dart SDK. السكربت
  يثبّت `unzip` ويضع SDK في `/opt/flutter` إن لم يكن موجوداً.
- `MCP_AUTH_SECRET` مطلوب في وضع oauth. بدونه تدخل `aichart-mcp` حلقة إعادة
  تشغيل. السكربت يولّده إن كان فارغاً.
