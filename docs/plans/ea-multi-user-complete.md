# إكمال جاهزية تعدد المستخدمين (جسر EA)

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06-18  
> **يعتمد على:** [ea-multi-user-audit.md](./ea-multi-user-audit.md)  
> **النسخة الكاملة:** [`originals/ea_multi-user_complete_c021c7b5.plan.md`](./originals/ea_multi-user_complete_c021c7b5.plan.md)

---

## نتيجة التنفيذ (ملخص)

| المرحلة | النتيجة |
|---------|---------|
| Phase 1 — تحقق VPS | `AICHART_SINGLE_USER=0`، `FOREX_BACKEND=ea`، `REDIS_URL` مفعّل |
| Phase 2 — سكربتات EA | `infra/tmp-test-ea-isolation.py` + `tmp-vps-ea-isolation-test.sh` |
| Phase 3.1 — UNIQUE token_hash | migration في `pg.ts` + `sqlite.ts`؛ index على VPS |
| Phase 3.2 — Redis eaLiveState | `persistQuotesToRedis` + getters async |
| Phase 4 — توثيق + نشر | قسم في `docs/EA_WINDOWS_VPS.md`؛ deploy tarball |
| اختبارات | 44/44 `npm run test:bridge` |
| فحص عزل VPS | bridge + EA isolation — **ALL PASS** |

**ملاحظة تشغيلية:** الخبير على MT5 Windows كان offline (heartbeat قديم) — يحتاج إعادة ربط يدوي.  
**ملاحظة نشر:** إصلاح 502 — `vps-fix-web-port.sh` (PORT 3010 وليس 3000).

---

## السياق

التدقيق خلّص ~75–85% جاهز. المتبقي: تحقق إنتاجي + hardening + اختبار EA.

| الوضع | المعنى | يكفي للتحقق؟ |
|-------|--------|--------------|
| Minimum | مستخدم A بخبير؛ B بدون | نعم |
| Ideal | مستخدمان + MT5 منفصلان | الأفضل |

---

## Phase 1 — تحقق تشغيلي

### 1.1 فحص بيئة VPS (`72.60.83.140`)

| المتغير | المطلوب |
|---------|---------|
| `AICHART_SINGLE_USER` | `0` |
| `FOREX_BACKEND` | `ea` |
| `AICHART_SERVICE_TOKEN` | ≥16 حرف |
| `REDIS_URL` | مفعّل |
| PM2 instances | `1` (OK) |

**معايير PASS bridge:**
- بدون `X-Aichart-User-Email` → 400
- توقيع مزوّر → 403
- مستخدمان A/B → 200

### 1.2–1.3 اختبار minimum

- A: mt/status, diagnostics, live-quotes
- B: لا يرى login/broker لـ A
- SQL: صف واحد per `user_id` في `ea_connections`

---

## Phase 2 — سكربت اختبار EA موسّع

### `infra/tmp-test-ea-isolation.py`

| # | الفحص |
|---|--------|
| 1 | A: mt/status backend=ea |
| 2 | B: online=false أو login ≠ A |
| 3 | A: live-quotes أو heartbeat fallback |
| 4 | B: count=0 أو no fresh |
| 5 | readiness مختلف |
| 6 | diagnostics — B لا login A |

### `infra/tmp-vps-ea-isolation-test.sh`

wrapper VPS + طباعة `ea_connections`.

---

## Phase 3 — Hardening

### 3.1 UNIQUE على `token_hash`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_ea_connections_token_unique
  ON ea_connections (token_hash);
```

- `web/src/lib/db/pg.ts`
- `web/src/lib/db/sqlite.ts`

### 3.2 Redis لـ `eaLiveState`

| عملية | السلوك |
|--------|--------|
| `updateEaLiveQuotes` | memory + Redis TTL ~120s |
| getters | memory أولاً؛ hydrate من Redis |
| بدون Redis | سلوك سابق |

**ملفات:** `eaLiveState.ts`, `forexPreflight.ts`, `forexPrice.ts`, `live/account/route.ts`, `ea/quotes/route.ts`

**اختبار:** `web/src/lib/__tests__/eaLiveStateRedis.test.ts`

---

## Phase 4 — توثيق ونشر

- قسم «تعدد المستخدمين + EA» في `docs/EA_WINDOWS_VPS.md`
- `infra/tmp-vps-finish-multi-user.sh` — فحص شامل
- `infra/pm2.ecosystem.config.cjs` — PORT 3010 (منع 502)

---

## معايير «تم الإكمال»

- [x] `AICHART_SINGLE_USER=0` على VPS
- [x] `tmp-test-bridge-isolation.py` — ALL PASS
- [x] `tmp-test-ea-isolation.py` — ALL PASS
- [x] UNIQUE(token_hash) في pg + sqlite + VPS
- [x] `eaLiveState` + Redis
- [x] `npm run test:bridge` PASS
- [x] توثيق onboarding multi-user EA

---

## خارج النطاق (تأجيل)

- عدة جسور EA لنفس المستخدم (MT5 على جهازين)
- `master_kill` عام
- quote-staleness / confidence gate (مؤكّدة؛ فقط عزل user_id)

---

## قائمة مهام

- [x] phase1-vps-env
- [x] phase1-ea-minimum
- [x] phase2-ea-script
- [x] phase3-unique-token
- [x] phase3-redis-quotes
- [x] phase4-docs-deploy
