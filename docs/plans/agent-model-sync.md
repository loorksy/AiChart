# مزامنة مودل الوكيل مع لوحة الأدمن

> **الحالة:** منفّذ (baseline-verify: pending)  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/مزامنة_مودل_الوكيل_e919e562.plan.md`](./originals/مزامنة_مودل_الوكيل_e919e562.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| مكتبة المزامنة | `web/src/lib/openclawModelSync.ts` |
| auto-sync | `PUT /api/admin/config` عند تغيير `ANTHROPIC_MODEL` |
| سكربت VPS | `agent/scripts/sync-model.sh` — `thinking=off`, telegram block |
| drift UI | `GET /api/admin/agent-model-status` + AdminKeysPanel |
| Anthropic API | `anthropic-messages` يُحفظ عند sync |

## الهدف

اختيار النموذج في `/admin/keys` يُحدّث `openclaw.json` تلقائياً — بوت Telegram يستخدم نفس المودل.

## قائمة مهام

- [x] openclaw-sync-lib
- [x] admin-config-hook
- [x] sync-script-update
- [x] admin-drift-ui
- [x] soul-no-leak
- [x] vps-apply
- [ ] baseline-verify
