# chart-host — جلسة الشارت المعزولة

حاوية مستقلة تستضيف **تبويباً واحداً** لصفحة `/chart-host` الداخلية عبر Playwright.
الغرض الوحيد: أن تعمل صفحة الشارت (TradingView) بلا مستخدم، فتجيب طلبات الالتقاط
بـ `takeClientScreenshot` من داخل الصفحة نفسها. **هذه العملية لا تلتقط شيئاً بنفسها**
— لا `page.screenshot()`، لا PDF، لا CDP — وترفض بالاسم أي عنوان غير صفحة الشارت
(`host_navigation_refused`).

العزل هو سبب الحاوية: إن علق التبويب أو سرّب ذاكرة يموت هنا (إعادة تدوير بعمر أقصى،
قتل بسقف الذاكرة، أو إعادة تشغيل الحاوية) دون أن يمسّ الوكيل المقيم.

## التشغيل

```bash
docker build -t aichart-chart-host ./chart-host

# --init «إلزامي» لا اختياري: بدونه يترك كل فتح/إغلاق للمتصفح ~3 عمليات
# Chromium زومبي، ومع --pids-limit=256 تتوقف الحاوية عن العمل بعد ~80 دورة.
# المنفذ 8788 على المضيف لأن 8787 مشغول بخدمة aichart-mcp.
docker run -d --name chart-host \
  --init --memory=1500m --pids-limit=256 --restart=unless-stopped \
  -p 127.0.0.1:8788:8787 \
  -e APP_URL="https://your-app-origin" \
  -e AICHART_SERVICE_TOKEN="<نفس قيمة التطبيق>" \
  aichart-chart-host
```

ثم في بيئة التطبيق:

```bash
CHART_HOST_URL=http://127.0.0.1:8788
# نفس السر يستخدم للتحكم ولتوقيع رمز الصفحة:
AICHART_SERVICE_TOKEN=<same>
```

بدون `CHART_HOST_URL` يعمل التطبيق كما قبل هذه الميزة تماماً: لا تبويب حي ⇒ فشل
مسمّى وينشر التحليل رقمياً.

## الضبط (كلها اختيارية)

| متغير | الافتراضي | المعنى |
| --- | --- | --- |
| `CHART_HOST_PORT` | `8787` | منفذ واجهة التحكم |
| `CHART_HOST_IDLE_MS` | `300000` | إغلاق التبويب بعد هذا الخمول (5 دقائق) |
| `CHART_HOST_MAX_AGE_MS` | `21600000` | إعادة تدوير المتصفح بعد هذا العمر (6 ساعات) |
| `CHART_HOST_MAX_MEMORY_BYTES` | `1572864000` | سقف ذاكرة الحاوية (cgroup) — تجاوزه خطأ مسمّى `host_memory_exceeded` |
| `CHART_HOST_ENSURE_TIMEOUT_MS` | `30000` | مهلة فتح المتصفح + تحميل الصفحة |

وفي جانب التطبيق: `CHART_SNAPSHOT_CACHE_TTL_MS` (افتراضي **15000**، 0 يعطّل) نافذة
كاش اللقطة المشتركة، و`CHART_HOST_WARMUP_MS` مهلة انتظار أول poll بعد الفتح،
و`CHART_HOST_CONTROL_TOKEN` لفصل رمز التحكم عن `AICHART_SERVICE_TOKEN` عند الرغبة.

## واجهة التحكم

- `POST /session/ensure {pageUrl}` — بهيدر `Authorization: Bearer <token>`: يفتح
  التبويب إن لم يكن مفتوحاً (طلبات متزامنة تتشارك إطلاقاً واحداً). يرفض أي
  `pageUrl` خارج `${APP_URL}/chart-host`.
- `POST /session/close` — إغلاق فوري آمن.
- `GET /healthz` — بلا توثيق: `{ok, tabOpen, ageMs, idleMs, memoryBytes, ensures, recycles, lastError}`.
  **قياس الذاكرة للتقرير يقرأ من هنا**: مرة والتبويب مفتوح، ومرة بعد نافذة الخمول.

## ملاحظات نشر

- الصفحة تصادق برمز HMAC (`kind: chart-host`) يصكّه التطبيق ويمرره في `pageUrl`;
  لا كوكيز ولا جلسة مستخدم داخل الحاوية.
- `--memory` في Docker خط الدفاع الأخير؛ السقف الداخلي يتصرف قبله بخطأ مسمّى.
- سجلات JSON على stdout: `launched / closed / recycled / launch_failed /
  memory_exceeded / refused_navigation`.
