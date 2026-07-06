# ربط AiChart MCP مع Claude.ai Connectors

## أين تضع عنوان MCP

**المسار:** [claude.ai/customize/connectors](https://claude.ai/customize/connectors) → **Add custom connector** (BETA)

| حقل الواجهة | القيمة |
|-------------|--------|
| **Name** | `AiChart Trading` |
| **Remote MCP server URL** | `https://aichart.lork.cloud/mcp` |
| **OAuth Client ID** (Advanced) | فارغ |
| **OAuth Client Secret** (Advanced) | فارغ |

### لا تضع في URL

- لا `AICHART_SERVICE_TOKEN`
- لا `?token=` في الرابط
- لا `/api/agent/…` — Claude يتصل بـ MCP Server فقط

---

## 1) تجهيز VPS

### تسجيل المستخدمين

```env
AICHART_SINGLE_USER=0   # 0 = تسجيل متعدد؛ 1 = مشغّل واحد فقط
```

- مستخدم جديد: `status=pending` — الكونسول وMCP مقفلان حتى موافقة الأدmin.
- الموافقة من **المنصة → المستخدمون** مع تحديد أيام الصلاحية (افتراضي **30**).

### متغيرات في `web/.env`

```env
AICHART_SERVICE_TOKEN=...          # موجود مسبقاً
# AGENT_WAKE_ENABLED=1             # افتراضي: معطّل — قرارات MCP فقط
MCP_AUTH_SECRET=...                # openssl rand -hex 32
MCP_PUBLIC_URL=https://aichart.lork.cloud/mcp
MCP_PORT=8787
MCP_AUTH_MODE=oauth
MCP_ACCESS_TOKEN_TTL_DAYS=365
MCP_REFRESH_TOKEN_TTL_DAYS=365
```

`MCP_AUTH_SECRET` **نفس القيمة** على عملية MCP وفي web (لـ `/api/admin/mcp-auth/verify`).

### مصادقة ثابتة (v2)

- **Access token:** JWT موقّع — صالح **365 يوم** — يبقى بعد `pm2 restart aichart-mcp`
- **Refresh token:** مخزّن في SQLite — Claude يجدّد تلقائياً
- **OAuth clients:** مخزّنة في SQLite — لا تُفقد عند restart

بعد ترقية MCP لأول مرة: **أعد OAuth في Claude مرة واحدة** (التوكنات القديمة UUID لم تعد صالحة).

### نشر MCP

```bash
cd /opt/aichart
bash infra/vps-mcp-deploy.sh
```

### nginx

أضف محتوى [`infra/nginx/aichart-mcp.conf`](../infra/nginx/aichart-mcp.conf) داخل vhost `aichart.lork.cloud`:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### تحقق

```bash
curl -s https://aichart.lork.cloud/health
curl -sI https://aichart.lork.cloud/.well-known/oauth-protected-resource
```

---

## 2) ربط Claude

1. Customize → Connectors → Add custom connector
2. URL: `https://aichart.lork.cloud/mcp`
3. Add → يفتح OAuth → سجّل دخول **حسابك في AiChart** (بعد موافقة الأدmin)
4. بعد الموافقة تظهر أدوات التداول في الشات

---

## 3) أمثلة prompts

```
خذ صفقة
```
→ Claude يسأل الزوج، يمسح البدائل، يعرض الحساب، يسأل المبلغ.

```
EURUSD أو GBPUSD — أيهما أفضل؟
```

```
0.01 lot — نفّذ
```

```
خسرنا — كيف نعوّض؟
```

```
ورّيني الحساب والصفقات المفتوحة
```

---

## 4) تعليمات Claude (Project) — انسخ إلى Project Instructions

```
أنت وكيل تداول موكّل عني عبر AiChart MCP. تتكلم بصيغة «نحن»: «ندخل» / «لا ندخل» / «دخلنا» / «خسرنا» — لا «تدخل».

بداية أي جلسة تداول:
1. get_account_overview
2. اذكر الرصيد، demo/live، الرافعة، PnL اليوم، perTradeMaxUsd

عند «خذ صفقة» أو أي أمر عام:
1. اسأل عن الزوج إن لم يُذكر (الزوج والمبلغ يُسألان — أما الاتجاه فتقرّره أنت)
2. scan_market + get_market_snapshot — قارن بدائل (EURUSD vs GBPUSD …)
3. get_trade_lessons (+ recent:true) — شرط قبلي
4. قيّم لجنة الوكلاء الأربعة (Trend/Breakout/MeanReversion/Risk — تشخيصية) واقرأ aichart://execution-desk
5. **قرّر الاتجاه (شراء/بيع) بنفسك من التحليل — لا تسأل المستخدم «شراء أم بيع؟»**
6. اقترح أو ارفض على أساس الجدارة (لا عتبة ثقة) — مع وقف محدّد و R:R مقبول

قبل open_trade:
- اسأل: بكم ندخل؟ (حجم اللوت أو الهامش) — لا تستخدم perTradeMax تلقائياً (في auto يُشتقّ الحجم من مسافة الوقف)
- create_recommendation أولاً (rationale + confidence + شارت)
- open_trade بعد الموافقة + notional + approved_by_user:true + **stop_loss إلزامي** + entry/take_profit (للـ R:R)
- الانضباط الموضوعي: Risk Guard يرفض الصفقة بلا وقف أو بعائد/مخاطرة أقل من الحد الأدنى — **ليست عتبة ثقة**

بعد خسارة:
- get_risk_status + get_trade_lessons recent:true
- لا revenge — لا مضاعفة المبلغ
- خطة تعويض واقعية

Risk Guard يرفض تجاوز الحدود — انقل السبب حرفياً.
اقرأ aichart://trading-rules عند الحاجة.
```

### متى create_recommendation vs open_trade

| الخطوة | الأداة |
|--------|--------|
| رأي + شارت + ثقة | `create_recommendation` |
| تنفيذ فعلي | `open_trade` (بعد موافقة + مبلغ) |

### قائمة أدوات MCP (كاملة)

| الفئة | الأدوات |
|-------|---------|
| **حالة** | `get_account_overview`, `get_risk_status`, `get_agent_capabilities`, `get_agent_settings`, `get_execution_env`, `get_live_account` |
| **إعدادات** | `set_execution_env`, `set_trading_mode`, `set_active_market`, `set_futures_enabled`, `set_kill_switch` |
| **سوق** | `get_market_snapshot`, `get_market_price`, `get_market_context`, `scan_market` |
| **محفظة** | `get_portfolio`, `get_open_trades`, `get_trade_lessons`, `get_pending_approvals` |
| **تداول** | `create_recommendation`, `open_trade`, `close_trade`, `evaluate_trade`, `record_exit_decision` |
| **موافقات** | `request_approval`, `respond_approval` |
| **MT5 EA** | `connect_mt5`, `disconnect_mt5`, `get_ea_diagnostics`, `get_ea_live_quotes`, `get_trade_readiness`, `capture_mt5_chart`, `modify_sl_tp`, `open_pending_order`, `cancel_mt5_order`, `close_partial`, `query_mt5_terminal`, `get_account_symbols` |
| **شارت** | `capture_chart_snapshot`, `get_recommendation_chart`, `get_ohlc`, `detect_levels`, `get_forex_indicators` |
| **أخرى** | `run_trade_maintenance`, `send_telegram_menu` |

### أمثلة إضافية

```
set_active_market forex ثم get_trade_readiness — تحقق quoteAgeMs و EA online
```

```
open_trade EURUSD stop_loss 1.15800 take_profit 1.16500 approved_by_user true
```

---

## استكشاف الأخطاء

| العرض | الحل |
|-------|------|
| Add معطّل / فشل الاتصال | تحقق `curl /health` و nginx `/mcp` |
| OAuth loop | امسح cookies `aichart_mcp_session` |
| 401 على الأدوات | أعد ربط Connector (مرة واحدة بعد ترقية JWT) |
| أدوات تفشل بعد restart | يجب ألا يحدث — JWT ثابت؛ تحقق `pm2 logs aichart-mcp` |
| Bridge 503 | `AICHART_SERVICE_TOKEN` في web + MCP |
| login فاشل | `MCP_AUTH_SECRET` متطابق؛ حساب admin |
