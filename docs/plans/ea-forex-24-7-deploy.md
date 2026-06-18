# EA Forex 24/7 Deploy (Linux + Windows VPS)

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/ea_forex_24_7_deploy_bf4e826d.plan.md`](./originals/ea_forex_24_7_deploy_bf4e826d.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| `FOREX_BACKEND=ea` على Linux | تعطيل `MT5_BRIDGE_*` وإيقاف حاوية mt5 |
| مسح فوركس | `POST /api/agent/market/scan` مع `market: forex` |
| دليل Windows | [`docs/EA_WINDOWS_VPS.md`](../EA_WINDOWS_VPS.md) |
| سكربتات VPS | `vps-switch-forex-ea.sh`, `vps-ea-deploy.sh`, `vps-ea-verify.sh` |
| إعدادات DB | `active_market=forex`, `allowed_assets` |

## الهدف

التحويل من MT5 Local (IPC timeout على Wine/Linux) إلى **جسر EA** على VPS Windows مع Linux يدير OpenClaw + Bridge.

## قائمة مهام

- [x] linux-ea-switch
- [x] windows-vps-doc
- [x] agent-forex-scan
- [x] env-docs
- [x] windows-ea-install (دليل + خطوات)
- [x] aichart-settings
- [x] e2e-verify (جزئي حتى اتصال EA)
