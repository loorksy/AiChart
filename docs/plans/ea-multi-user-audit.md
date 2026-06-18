# تقييم جاهزية تعدد المستخدمين (جسر EA)

> **الحالة:** تقييم فقط — **مكتمل** (بدون تعديل كود في هذه المرحلة)  
> **التاريخ:** 2026-06-17  
> **النوع:** فحص read-only قبل قرار التوسع  
> **النسخة الكاملة:** [`originals/ea_multi-user_audit_855ef326.plan.md`](./originals/ea_multi-user_audit_855ef326.plan.md)

---

## ملخص تنفيذي

**الحكم العام:** البنية **ليست** «مبنية لمستخدم واحد» — مسار الخبير مصمم أصلاً لعزل `user_id` في قاعدة البيانات والذاكرة وطابور الأوامر.

**نسبة العمل المتبقي للوصول لتعدد مستخدمين «كامل»:** تقريباً **15–25%** — ليس إعادة هيكلة هوية، بل تحقق تشغيلي + hardening.

---

## 1) ربط الهوية — الخبير → مستخدم

| البند | الحكم | الدليل |
|-------|--------|--------|
| heartbeat / quotes / DB | 🟢 | `requireEaConnection` → `conn.user_id`؛ `recordEaHeartbeat(userId)` |
| توكن الخبير | 🟢 لكل مستخدم | `POST /api/ea/token`؛ `generateEaToken()` |
| جسران متزامnan | 🟢 | `quotesByUser` Map مفهرسة بـ userId |

**قيد تصميمي:** `UNIQUE(user_id)` — جسر واحد لكل حساب AiChart.

---

## 2) العزل عند القراءة

| البند | الحكم |
|-------|--------|
| `eaLiveState` | 🟢 (+ 🟡 multi-instance بدون Redis) |
| قراءات MCP/agent | 🟢 (+ 🟡 إذا `AICHART_SINGLE_USER=1`) |
| debounce 3 نبضات | 🟢 per-user |

---

## 3) التنفيذ والمخاطر

| البند | الحكم |
|-------|--------|
| `open_trade` routing | 🟢 → `createEaCommand(userId)` |
| Risk Guard caps/PnL | 🟢 per-user |
| `master_kill` | 🟡 عام (منصّة) |
| idempotency | 🟢 `PRIMARY KEY (user_id, key)` |

---

## 4) التوكن — EA والمنصّة

- `AiChartBridge.mq5` — `input EaToken` (هوية = التوكن)
- `EaConnectCard` — توليد من لوحة التحكم

---

## جدول الحكم السريع

| البند | الحكم |
|-------|--------|
| ربط هوية EA | 🟢 |
| توكن EA | 🟢 |
| eaLiveState | 🟢 (+ 🟡) |
| open_trade | 🟢 |
| idempotency | 🟢 |

---

## ما ليس جاهزاً / قيود

1. 🟡 جسر واحد لكل user (`UNIQUE user_id`)
2. 🟡 quotes in-memory — يحتاج Redis إذا instances > 1
3. 🟡 `AICHART_SINGLE_USER=1` — legacy single-user
4. 🟡 `master_kill` — إيقاف شامل مقصود

---

## الخطوة التالية

→ نُفّذت في **[ea-multi-user-complete.md](./ea-multi-user-complete.md)**

---

## قائمة مهام (من التقييم)

- [x] verify-env — (أُكمل في الخطة 3)
- [x] run-isolation-test — سكربتات `tmp-test-*-isolation.py`
- [x] optional-hardening — UNIQUE + Redis (الخطة 3)
