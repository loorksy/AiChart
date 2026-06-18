# خطة EA + Token وتبديل كريبتو / فوركس

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/ea_token_+_market_ui_aff9b46c.plan.md`](./originals/ea_token_+_market_ui_aff9b46c.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| Schema | `MarketType` + جداول `ea_connections`/`ea_commands`/`ea_market_cache` + `active_market` |
| API الجسر | `/api/ea/*` — heartbeat, commands, ack, token, status + `eaAuth.ts` |
| EA | `AiChartBridge.mq4` + `AiChartBridge.mq5` + `docs/EA_BRIDGE.md` |
| BrokerAdapter | `binanceAdapter` + `eaAdapter` + `lotSizing` + refactor `execution.ts` |
| بيانات السوق | klines/tickers/instruments/analyze لـ `market=forex` من EA cache |
| الواجهة | `MarketTypeSelector` + `EaConnectCard` + onboarding + Dashboard status |
| الوكيل | Risk Guard + `allowedAssets` + سياق سوقين |

## القرارات

- MT4 و MT5 معاً · وضع مزدوج (Binance + EA) · بدون MetaApi في هذه المرحلة · Binance بدون كسر.

## قائمة مهام

- [x] schema-types
- [x] ea-api
- [x] ea-mql
- [x] broker-adapter
- [x] market-data
- [x] ui-market-selector
- [x] ui-settings-onboarding
- [x] agent-risk
