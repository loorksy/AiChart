# Odysseus — Trading Platform

Odysseus هو المنصة الرئيسية: تطبيق **Python / FastAPI** ذاتي الاستضافة يجمع بين
مساحة عمل الذكاء الاصطناعي (محادثة، وكلاء، أبحاث، مستندات…) و**منصة تداول فوركس
متكاملة** مدمجة داخل واجهة المحادثة.

> كامل التطبيق موجود في مجلد [`odysseusai/`](odysseusai/). منصة AiChart السابقة
> (Next.js) أُعيد بناء وظائفها بالكامل بلغة Python داخل Odysseus وأُزيلت.

## منصة التداول (Python أصلية)

| القدرة | الموقع |
|--------|--------|
| محرّك المخاطر (Risk Guard) + المؤشرات + reward:risk | `odysseusai/services/trading/{risk,indicators}.py` |
| بيانات السوق (OANDA v20) + اللقطة والتحليل | `odysseusai/services/trading/{market,analysis}.py` |
| جسر التنفيذ MT5/EA + تعيين الرموز | `odysseusai/services/trading/{execution,mt5map}.py` + `routes/ea_routes.py` |
| الاختبار التاريخي + دفتر الأداء | `odysseusai/services/trading/{backtest,journal}.py` |
| أدوات الوكيل الأصلية | `odysseusai/src/agent_tools/trading_tools.py` |
| واجهة المستخدم/الأدمن (محادثة + شارت TradingView) | `odysseusai/static/trading.html` + `static/js/trading_workspace.js` + `tv_*.js` |
| الـ Expert Advisor لِـ MetaTrader 5 | `odysseusai/ea/mt5/OdysseusBridge.mq5` |

- **الأوضاع الثلاثة:** يدوي (تحليل/توصية فقط) · نصف‑آلي (تجهيز صفقة + تنفيذ يدوي)
  · آلي‑كامل (تنفيذ عبر Risk Guard) — مع **إيقاف طارئ** و**Kill Switch** للأدمن.
- **البيانات من OANDA، التنفيذ عبر MT5 فقط.** لا تنفيذ بدون جسر متصل ووقف خسارة.
- الشارت من **TradingView Advanced Charting Library** (تضع أصولك المرخّصة في
  `odysseusai/charting_library/`) مع بديل شمعي مدمج.

## التشغيل

```bash
cd odysseusai
cp .env.example .env      # املأ ENCRYPTION/APP secrets + OANDA_* (اختياري)
docker compose up -d --build
# أو محلياً:
pip install -r requirements.txt && python app.py
```

افتح `http://localhost:7000` ثم `/trading` لمساحة التداول. ربط MetaTrader 5 في
[`odysseusai/ea/README.md`](odysseusai/ea/README.md).

## الاختبارات

```bash
cd odysseusai
pytest tests/test_trading_engine.py -q
```

## الترخيص

AGPL-3.0-or-later — راجع [`odysseusai/LICENSE`](odysseusai/LICENSE).
