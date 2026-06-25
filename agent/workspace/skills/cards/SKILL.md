# مهارة البطاقات التفاعلية (Interactive Cards Skill)

دليلك لكيفية ومتى تعرض **بطاقات تفاعلية** (نماذج مصغّرة) للمستخدم في منصة AiChart بدل النص الجاف.

## البروتوكول (Card Protocol) — مستقل عن الموديل والمزوّد
البطاقات في AiChart **بروتوكول أصيل في النظام**، لا ميزة خاصة بموديل واحد. تعمل مع **أي موديل من أي شركة** (OpenAI / Anthropic / Google / OpenRouter) لأنها:
- **بيانات تصريحية لا كود**: تُرسل كـ `ui_schema = { version: "1.0", layout: UIElement[] }`، و`UIElement = { id, component, props, children? }` — قائمة مسطّحة بمراجع ID تُسقطها الواجهة على مكوّنات أصلية. (نفس فلسفة معيارَي **A2UI** من Google و**AG-UI** من CopilotKit.)
- **طبقتا ضمان**: (1) أنت تستدعي `render_cards` (يمرّ عبر طبقة أدوات موحّدة تعمل مع كل المزوّدات)؛ (2) وإن لم تفعل، **النظام يولّد البطاقة حتمياً** من نواتج أدواتك (مُركِّب server-side مستقل عن الموديل). فالبطاقة تظهر دائماً عند وجود بيانات.

## القاعدة الذهبية
- **أي رد يحتوي بيانات** (تحليل زوج، أسعار، أزواج الحساب، المحفظة، الصفقات، اقتراح دخول) → **اعرضه كبطاقة واحدة مناسبة للمرحلة**، ولا تكتفِ بسرده نصاً.
- **محادثة عامة / تحية / توضيح بسيط** → نص فقط، بلا بطاقة.
- اكتب دائماً جملة أو جملتين بشريّتين موجزتين مع البطاقة (البطاقة تكمّل النص لا تلغيه).
- **كل بطاقة في وقته**: تحليل → analysis فقط؛ صفقة → order_ticket أو risk_reward أو record_recommendation (واحدة)؛ موافقة → trade_confirm/intent فقط.
- **حد أقصى بطاقتين** في render_cards.layout؛ **بطاقة واحدة** عند اقتراح صفقة. اذكر لماذا اخترت هذه البطاقة.

## مصفوفة المرحلة → البطاقة
| المرحلة | البطاقة | ممنوع في نفس الرد |
|---|---|---|
| تحليل زوج | `analysis` واحدة (RSI/SR في props) | order_ticket, risk_reward, rsi_gauge, sr_ladder |
| اقتراح صفقة | record_recommendation **أو** order_ticket **أو** risk_reward | analysis + gauges معاً |
| بعد record_recommendation | لا render_cards إضافية | أي تكرار لمستويات SL/TP |
| موافقة معلّقة | trade_confirm / intent | order_ticket + analysis |
| حساب/صفقات | account_overview, positions_table | بطاقات تحليل/صفقة |

## كيف تعرض بطاقة (مهم)
**استدعِ أداة `render_cards`** ومعها `layout` (مصفوفة عناصر — **1–2 كحد أقصى**). **لا تكتب JSON أو كتل كود في نصّك** — لن يُعرض.

> ملاحظة: حتى إن نسيت استدعاء render_cards، يحاول الخادم توليد بطاقة من بيانات الأدوات التي استدعيتها — لكن **الأفضل أن تستدعيها بنفسك** لتختار البطاقة الأغنى والأنسب.

## الربط بين الأدوات والبطاقات (افعلها تلقائياً)
| بعد استدعاء | اعرض البطاقة |
|---|---|
| get_account_symbols | `pair_browser` (مرّر symbols) |
| get_market_snapshot / تحليل زوج | `analysis` **واحدة** (RSI/SR في props) |
| get_account_overview | `account_overview` |
| get_open_trades | `positions_table` |
| اقتراح/تعديل صفقة | record_recommendation **أو** `order_ticket` **أو** `risk_reward` — **واحدة فقط** |
| مقارنة عدة أزواج | `change_grid` أو `heatmap` أو `table` |

## كتالوج المكوّنات
### تنفيذ وصفقات
- `order_ticket` — تذكرة أمر قابلة للتعديل. props: symbol, side, notional, entry, stop_loss, take_profit, intentId?, balance?, editable?
- `quick_trade` (symbol, price?) · `close_position` (symbol, size, pnl?, tradeId?) · `modify_sltp` (symbol, entry, stop_loss, take_profit, tradeId?) · `position_sizer` (balance?, riskPct?, stopDistance?) · `risk_reward` (entry, stop_loss, take_profit) · `bracket_order` (symbol, side) · `trade_confirm` (symbol, side, notional, intentId)

### تحليل
- `analysis` — props: symbol, price, trend (bullish/bearish/neutral), rsi, macd, support, resistance, summary
- `rsi_gauge` (value, symbol?) · `macd_meter` (value|bars[]) · `trend_meter` (score -100..100) · `sr_ladder` (symbol, levels:[{price,type}]) · `mtf_grid` (rows:[{tf,signal}]) · `pattern_card` (pattern, confidence) · `confidence_meter` (value) · `signal_strength` (score) · `indicator_tabs` (items:[{key,label,value,note}])

### السوق وأزواج الحساب
- `pair_browser` (symbols:[{symbol,market,bid,ask,spreadPct}]) · `watchlist` · `price_ticker` (symbol, price, changePct) · `spread_monitor` (symbol, spreadPct, threshold?) · `movers` · `heatmap` (cells:[{symbol,changePct}]) · `change_grid` · `depth_mini`

### الحساب والمحفظة
- `account_overview` (balance, equity, margin, freeMargin, marginLevel) · `equity_sparkline` (points[]) · `positions_table` (positions:[{symbol,side,size,pnl,tradeId}]) · `pnl_summary` (realized, unrealized) · `margin_gauge` (marginLevel) · `allocation_donut` (slices:[{label,value}]) · `exposure_bars` (longPct, shortPct) · `balance_card`

### تصوّر عام
- `gauge` · `progress_ring` · `sparkline` · `bar_compare` · `stat_grid` · `timeline` · `kpi_card` · `donut`

### تحكّم وسير عمل
- `timeframe_picker` · `market_switch` · `mode_switch` · `strategy_picker` · `checklist` · `step_progress` · `fear_greed` (value) · `news_feed` · `alert_banner` (type,title?,text) · `confirm_dialog` · `quick_actions`

### شارت مصغّر
- `candles_mini` (candles:[{o,h,l,c}]) · `area_spark` (points[]) · `compare_chart` · `range_slider_chart`

## أمثلة قرار
- «حلّل EURUSD» → نص موجز + render_cards [ analysis ] فقط.
- «ما الأزواج المتاحة؟» → بعد get_account_symbols → render_cards [ pair_browser ].
- «نظرة على حسابي» → بعد get_account_overview + get_open_trades → render_cards [ account_overview, positions_table ].
- «أريد دخول بيع على XAUUSD» → record_recommendation **أو** render_cards [ order_ticket ] — لا analysis + order_ticket معاً.
- «شكراً» / «كيف حالك» → نص فقط، بلا بطاقة.

## توقيع `render_cards`
```
render_cards({ layout: UIElement[] })
UIElement = { id: string, component: string, props: object, children?: UIElement[] }
```
مثال كامل:
```
render_cards({ "layout": [
  { "id": "a1", "component": "analysis", "props": { "symbol": "EURUSD", "price": 1.165, "trend": "neutral", "rsi": "41 (محايد)", "macd": "زخم ضعيف", "support": 1.158, "resistance": 1.172, "summary": "السوق عرضي — الأفضل الانتظار." } }
] })
```

## سجل الإجراءات (Actions) — المسموح فقط داخل أزرار البطاقات
| action | payload | الأثر |
|---|---|---|
| `submit_prompt` | `{ text }` | يرسل `text` كرسالة جديدة للوكيل (لتعديل صفقة/طلب تحليل/تبديل وضع…). |
| `inject_input` | `{ text }` | يملأ حقل الإدخال بـ`text` دون إرسال. |
| `execute_trade` | `{ intentId }` | يوافق على نية صفقة معلّقة (يمرّ عبر Risk Guard). |
| `reject_trade` | `{ intentId }` | يرفض نية صفقة معلّقة. |

## مرجع نداءات الوكيل (API & IDs) — كل ما تحتاجه لجلب البيانات ثم عرضها كبطاقة
أدوات بيانات (read-only) ونقاط النهاية المقابلة عبر الجسر الداخلي:
| الأداة (tool id) | النداء | المعاملات | الناتج → البطاقة |
|---|---|---|---|
| `get_account_symbols` | `GET /api/agent/ea/symbols` | `q?`, `market?` (forex/crypto), `limit?` | `{ symbols[] }` → `pair_browser` |
| `get_market_snapshot` | محلي (Binance/EA) | `symbol`, `interval?` | لقطة `{symbol,price,extra{trend,rsi14,macd},high24h,low24h,summary}` → `analysis` |
| `get_multi_timeframe_snapshot` | `GET /api/agent/market/multi-snapshot` | `symbol`, `intervals?`, `market?` | `{ snapshots[] }` → `analysis` + `mtf_grid` |
| `get_account_overview` | `GET /api/agent/{risk/status, portfolio, live/account}` | `include_live?` | `{ risk, portfolio, live }` → `account_overview` |
| `get_open_trades` | `GET /api/agent/trades/open` | — | `{ aichartTrades[], brokerPositions }` → `positions_table` |
| `get_risk_status` | `GET /api/agent/risk/status` | — | حالة المخاطر → `stat_grid`/`alert_banner` |
| `get_trade_readiness` | `GET /api/agent/trade/readiness` | `symbol?`, `market?`, `confidence?` | `{ ready, blockers[] }` → `alert_banner` |
| `scan_market` | `POST /api/agent/market/scan` | معايير المسح | فرص → `table`/`heatmap` |
| `get_scalp_status` | `GET /api/agent/scalp` | — | إذن/حالة السكالب |

أدوات تنفيذ/تحكّم (تمرّ عبر Risk Guard — لا تُكسر):
| الأداة | النداء | ملاحظة |
|---|---|---|
| `open_trade` | `POST /api/agent/trade/open` | في وضع موافقة يُنشئ نية معلّقة → بطاقة موافقة. |
| `close_trade` | `POST /api/agent/trade/close` | إغلاق صفقة/الكل. |
| `modify_sl_tp` | `POST /api/agent/ea/modify-sl-tp` | تعديل وقف/هدف. |
| `request_approval` | `POST /api/agent/approval/request` | يُنشئ نية معلّقة + بطاقة موافقة. |
| `set_trading_mode` | `POST /api/agent/mode` | تلقائي/موافقة/مباشر. |
| `set_active_market` | `PATCH /api/agent/settings` | كريبتو/فوركس. |
| `set_trading_style` | `POST /api/agent/style` | scalp/day/swing/position. |
| `start_scalp_session` / `stop_scalp_session` | `POST /api/agent/scalp` | بدء/إيقاف جلسة سكالب. |
| `render_cards` | محلي (عرض) | عرض البطاقات (لا نداء شبكة). |
| `get_cards_guide` | محلي | يقرأ هذه المهارة. |

> نمط الاستخدام: استدعِ أداة البيانات → استدعِ `render_cards` بالبطاقة المناسبة من نفس الناتج (أو دع المُركِّب الحتمي يفعلها). كل النداءات مُصادَق عليها بهوية المستخدم تلقائياً عبر الجسر — لا تمرّر مفاتيح.

## القيود الأمنية
- أزرار البطاقات تستخدم الإجراءات المعتمدة فقط: `submit_prompt` · `inject_input` · `execute_trade` · `reject_trade`. أي تعديل أرقام (حجم/وقف/هدف) يمرّ عبر submit_prompt فيبقى التنفيذ خلف Risk Guard.
- لا تضع معالجات أحداث (on...) في props — تُحذف أمنياً.
