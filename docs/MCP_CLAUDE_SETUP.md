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
BTC أو ETH — أيهما أفضل؟
```

```
40 USDT — نفّذ
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
1. اسأل: على أي زوج ندخل؟
2. scan_market + get_market_snapshot — قارن بدائل (BTC vs ETH …)
3. get_trade_lessons (+ recent:true)
4. اقترح أو ارفض + ثقة % + 2–4 جمل

قبل open_trade:
- اسأل: بكم ندخل؟ (USDT) — لا تستخدم perTradeMax تلقائياً
- create_recommendation أولاً (rationale + confidence + شارت)
- open_trade فقط بعد موافقتي + notional + approved_by_user:true + stop_loss

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
| **Binance** | `connect_binance`, `verify_binance`, `get_binance_status`, `disconnect_binance`, `capture_binance_chart` |
| **Futures** | `get_futures_positions`, `get_futures_orders`, `modify_futures_sl_tp`, `cancel_futures_order` |
| **MT5 EA** | `get_ea_diagnostics`, `get_ea_live_quotes`, `capture_mt5_chart`, `modify_sl_tp`, `open_pending_order`, `cancel_mt5_order`, `close_partial`, `query_mt5_terminal` |
| **MT5 MetaApi** | `connect_mt5`, `disconnect_mt5`, `get_mt5_status` |
| **شارت** | `capture_chart_snapshot`, `get_recommendation_chart` |
| **أخرى** | `run_trade_maintenance`, `send_telegram_menu` |

### أمثلة إضافية

```
connect_binance testnet ثم get_binance_status
```

```
set_active_market forex ثم get_live_account — تحقق quoteAgeMs
```

```
open_trade BTCUSDT market_type futures leverage 5 stop_loss …
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
