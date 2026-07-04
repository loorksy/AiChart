# VPS Windows + جسر EA — دليل الإعداد 24/7

يربط MetaTrader 4/5 بمنصة AiChart على VPS Linux (`aichart.lork.cloud`) عبر Expert Advisor.
الاتصال **صادر** من Windows إلى HTTPS — لا حاجة لفتح منافذ واردة.

## المعمارية

```
VPS Linux (AiChart)  <── HTTPS heartbeat كل 1ث ──  VPS Windows (MT5 + EA)
  Claude MCP + Risk Guard                              حساب الوسيط (Liirat-Live)
```

## 0) التفعيل مرة واحدة — أوقف إعادة التفعيل عند تبديل الأزواج/الفريمات

**المشكلة:** كل ما تبدّل الرمز أو الفريم على الشارت، يتوقف الجسر ويطلب إعادة تفعيل
AutoTrading. **السبب:** إعداد أمان في الطرفية، لا في الـ EA — لا يستطيع أي كود EA
تجاوزه. الحل مرة واحدة:

1. **MT5 → Tools → Options → Expert Advisors**، فعّل:
   - ✅ `Allow algorithmic trading`
   - **ألغِ ✅** من الثلاثة التالية (هي سبب إعادة التفعيل):
     - `Disable algorithmic trading when the account has been changed`
     - `Disable algorithmic trading when the profile has been changed`
     - **`Disable algorithmic trading when the charts symbol or period has been changed`** ← الأهم
   - ✅ `Allow WebRequest for listed URL` وأضف `https://aichart.lork.cloud` (سطر واحد يكفي)
2. اضغط زر **AutoTrading** الأخضر مرة واحدة (يبقى مفعّلاً بعدها).
3. عند سحب الـ EA على الشارت: فعّل ✅ `Allow Algo Trading` فقط. (خيار
   `Allow modification of Signals settings` غير مطلوب للجسر — اتركه.)
4. **خصّص شارتاً للجسر:** اسحب الـ EA على شارت واحد ولا تبدّل رمزه/فريمه، وتصفّح
   بقية الأزواج في نوافذ شارت أخرى. الجسر يخدم **كل** الرموز التي يطلبها الوكيل
   تلقائياً — لا يحتاج أن يكون على شارت الزوج الذي تنظر إليه.

بعد هذه الخطوة، لوحة الحالة على الشارت تعرض `AutoTrading: [ON]` و
`Platform link: [ONLINE]` وتبقى كذلك عبر التبديلات. (لوحة الحالة أُضيفت في
EA v4.05 — إن لم تظهر، أعد ترجمة `AiChartBridge.mq5` وأعد سحبه.)

## 0.1) MetaQuotes Virtual Hosting — VPS مدمج في MT5 للتشغيل 24/7

بدل استئجار VPS Windows منفصل، MetaTrader يوفّر **خادماً افتراضياً مدمجاً** يعمل
24/7 حتى لو أطفأت جهازك (هذا ما تقصده بـ «VPS من خدمات meta5»):

1. في MT5: انقر يميناً على الشارت الذي عليه الـ EA → **Register a Virtual Server**
   (أو من قائمة `Trade` → `Virtual Hosting`).
2. اختر أقرب مركز بيانات (يعرض زمن الوصول لوسيطك) واشترك (رسوم شهرية بسيطة).
3. اختر **Migrate → Experts and Market Watch** لنسخ الـ EA وإعداداته إلى الخادم.
4. الخادم الافتراضي يعمل نسخة MT5 headless تعمل دائماً — **لا أحد يبدّل رموزه**،
   لذلك لا تنطفئ AutoTrading أبداً، والجسر يبقى `[ONLINE]` على مدار الساعة.

> ملاحظة: بعد أي تعديل على إعدادات الـ EA أو إعادة ترجمته محلياً، أعد **Migrate**
> حتى ينسخ النسخة الجديدة إلى الخادم الافتراضي.

## 1) اختيار VPS Windows (بديل: خادم منفصل تديره بنفسك)

| المعيار | التوصية |
|---------|---------|
| النظام | Windows Server 2022 أو Windows 10/11 Pro |
| المنطقة | أوروبا (Frankfurt / Amsterdam) — قرب وسيط Liirat |
| المواصفات | 2 vCPU · 4 GB RAM (MT5 ~2GB؛ MT4+MT5 معاً 4GB) |
| مزودون | Contabo · OVH · Hetzner · AWS EC2 Windows |

## 2) إعداد Windows للتشغيل 24/7

1. **الطاقة:** Control Panel → Power Options → High Performance · Sleep = Never
2. **RDP:** للإدارة فقط؛ اترك MT5 يعمل بعد تسجيل الدخول
3. **جدار ناري:** لا تفتح منافذ واردة — EA يتصل صادراً إلى `https://aichart.lork.cloud`
4. **Task Scheduler (اختياري):** إعادة تشغيل MT5 عند التعطل — انظر `infra/windows/mt5-watchdog.ps1`

## 3) AiChart على Linux — التحويل إلى EA

```bash
cd /opt/aichart
bash infra/vps-disable-mt5.sh   # or: bash infra/vps-switch-forex-ea.sh
```

أو يدوياً في `web/.env`:

```env
FOREX_BACKEND=ea
#MT5_BRIDGE_URL=...
#MT5_BRIDGE_TOKEN=...
```

ثم: `pm2 restart aichart-web` و `docker compose -f infra/docker-compose.yml stop mt5`

## 4) تثبيت MetaTrader 5 (Liirat)

1. حمّل MT5 من موقع وسيط Liirat (مثبّت الوسيط يتضمن سيرفراته)
2. ثبّت وافتح MT5
3. File → Login to Trade Account:
   - Login: رقم حسابك
   - Server: `Liirat-Live` (حرفياً كما في MT5)
   - Password: كلمة مرور التداول
4. فعّل **Tools → Options → Expert Advisors** (راجع القسم 0 أعلاه للإعداد الدائم):
   - Allow algorithmic trading
   - Allow WebRequest (أضف `https://aichart.lork.cloud` إن طُلب)

## 5) تثبيت EA

1. من AiChart: **الإعدادات → الربط والتكامل → MetaTrader → توليد رمز EA**
2. انسخ EA يدوياً أو شغّل `infra/windows/install-ea-mt5.ps1` من clone المستودع
3. المسار اليدوي: `%APPDATA%\MetaQuotes\Terminal\<HASH>\MQL5\Experts\`
   - أو File → Open Data Folder → MQL5 → Experts
4. افتح MetaEditor → Compile (F7)
5. اسحب `AiChartBridge` على أي شارت
6. Inputs:
   - `ApiBase` = `https://aichart.lork.cloud`
   - `EaToken` = الرمز من الإعدادات
   - `StreamSymbol` = `EURUSD` (أو زوج من قائمة المراقبة)
   - `HeartbeatSeconds` = `1`
7. فعّل **AutoTrading** (الزر الأخضر)

## 6) إعدادات AiChart

| الإعداد | القيمة |
|---------|--------|
| active_market | forex |
| allowed_assets | أزواج Liirat (مثل EURUSD) |
| mode | auto أو approval |
| StreamSymbol في EA | يطابق زوجاً في المراقبة |

## 7) التحقق

| الاختبار | النجاح |
|----------|--------|
| الإعدادات → EA | **online** (نقطة ذهبية) |
| Experts tab في MT5 | وجوه مبتسمة على EA |
| شارت السوق (فوركس) | شموع تظهر |
| Claude MCP `GET /api/agent/portfolio` | `ea.online: true` |

## 8) MT4 (لاحقاً)

- نفس الخطوات مع `ea/mt4/AiChartBridge.mq4`
- **مطلوب:** WebRequest URL = `https://aichart.lork.cloud`
- النظام يدعم **اتصال EA واحد** (MT4 **أو** MT5) لكل مستخدم — لتشغيل الاثنين معاً يلزم توسيع لاحقاً

## 9) Claude MCP والتنفيذ

الوكيل ينفّذ عبر `POST /api/agent/trade/open` مع `market: "forex"`:
Risk Guard → `ea_commands` → EA → MT5 → الوسيط.

راجع [`docs/EA_BRIDGE.md`](EA_BRIDGE.md) و [`ea/README.md`](../ea/README.md).

## 10) تعدد المستخدمين + EA

كل مستخدم AiChart يربط **حساب MT5 الخاص به** على **جهازه** بتوكن معزول:

| القاعدة | التفاصيل |
|---------|----------|
| توken EA | **لكل مستخدم** — Console → EA → «توليد رمز» (`POST /api/ea/token`) |
| جسر واحد لكل حساب AiChart | `ea_connections.user_id` فريد — تدوير التوken يلغي القديم فوراً |
| MCP multi-user | `AICHART_SINGLE_USER=0` إلزامي في الإنتاج |
| Redis (اختياري) | `REDIS_URL` يشارك cache الأسعار الحية بين instances PM2 |

**Onboarding:**

1. `/signup` → موافقة admin من `/console/platform?tab=users`
2. تسجيل دخول → الإعدادات → توليد EA token
3. MT5 على Windows → لصق `EaToken` في خصائص EA
4. تحقق: `bash infra/tmp-vps-bridge-test.sh` و `bash infra/tmp-vps-ea-isolation-test.sh` على VPS

**Smoke scripts:**

- `infra/tmp-test-bridge-isolation.py` — عزل MCP (email + HMAC)
- `infra/tmp-test-ea-isolation.py` — عزل EA (user A online vs user B)

## استكشاف الأخطاء

| العرض | الحل |
|-------|------|
| EA offline في الإعدادات | MT5 مغلق · AutoTrading off · Token خاطئ · WebRequest محظور |
| لا شموع في الشارت | `StreamSymbol` غير موجود في Market Watch |
| رفض الأمر | EA offline >30ث · Risk Guard · رمز غير مسموح |
| WebRequest failed | أضف URL في MT4/MT5 Options |
