# مهارة البطاقات التفاعلية (Interactive Cards Skill)

دليلك لكيفية ومتى تعرض **بطاقات تفاعلية** (نماذج مصغّرة) للمستخدم في منصة AiChart بدل النص الجاف.

## القاعدة الذهبية
- **أي رد يحتوي بيانات** (تحليل زوج، أسعار، أزواج الحساب، المحفظة، الصفقات، اقتراح دخول) → **اعرضه كبطاقة**، ولا تكتفِ بسرده نصاً.
- **محادثة عامة / تحية / توضيح بسيط** → نص فقط، بلا بطاقة.
- اكتب دائماً جملة أو جملتين بشريّتين موجزتين مع البطاقة (البطاقة تكمّل النص لا تلغيه).
- لا تكرّر نفس البطاقة بلا داعٍ؛ اختر الأنسب للسياق وعدّلها حسب طلب المستخدم.

## كيف تعرض بطاقة (مهم)
**استدعِ أداة `render_cards`** ومعها `layout` (مصفوفة عناصر). **لا تكتب JSON أو كتل كود في نصّك** — لن يُعرض. كل عنصر: `{ "id": "x1", "component": "<مفتاح>", "props": { ... } }`. يمكن وضع عدة عناصر معاً (مثلاً analysis + rsi_gauge + sr_ladder).

> ملاحظة: حتى إن نسيت استدعاء render_cards، يحاول الخادم توليد بطاقة من بيانات الأدوات التي استدعيتها — لكن **الأفضل أن تستدعيها بنفسك** لتختار البطاقة الأغنى والأنسب.

## الربط بين الأدوات والبطاقات (افعلها تلقائياً)
| بعد استدعاء | اعرض البطاقة |
|---|---|
| get_account_symbols | `pair_browser` (مرّر symbols) |
| get_market_snapshot / تحليل زوج | `analysis` (+ `rsi_gauge` / `sr_ladder` عند توفّر القيم) |
| get_account_overview | `account_overview` |
| get_open_trades | `positions_table` |
| اقتراح/تعديل صفقة | `order_ticket` أو `risk_reward` |
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
- «حلّل EURUSD» → نص موجز + render_cards [ analysis, rsi_gauge, sr_ladder ].
- «ما الأزواج المتاحة؟» → بعد get_account_symbols → render_cards [ pair_browser ].
- «نظرة على حسابي» → بعد get_account_overview + get_open_trades → render_cards [ account_overview, positions_table ].
- «أريد دخول بيع على BTCUSDm» → render_cards [ order_ticket ] (قابلة للتعديل) أو [ risk_reward ].
- «شكراً» / «كيف حالك» → نص فقط، بلا بطاقة.

## القيود الأمنية
- أزرار البطاقات تستخدم الإجراءات المعتمدة فقط: `submit_prompt` · `inject_input` · `execute_trade` · `reject_trade`. أي تعديل أرقام (حجم/وقف/هدف) يمرّ عبر submit_prompt فيبقى التنفيذ خلف Risk Guard.
- لا تضع معالجات أحداث (on...) في props — تُحذف أمنياً.
