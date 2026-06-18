# AiChart — منصة SaaS

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/auth_ui_username_whatsapp_6dddfd6f.plan.md`](./originals/auth_ui_username_whatsapp_6dddfd6f.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| username + whatsapp | migration + `lib/phone.ts` |
| تسجيل موسّع | `POST /api/auth/register`, `PhoneInput.tsx` |
| Telegram → awaiting-approval | لا console قبل الموافقة |
| لوحة مستخدم | `UserShell`, `userNav`, `/console/mcp` |
| صفحة هبوط | `LandingPage` + أقسام |
| فصل nav أدmin/مستخدم | `AdminUsersTable`, display names |

## الهدف

منصة SaaS: هبوط → تسجيل → موافقة → لوحة + MCP؛ الأدmin على Bridge.

## قائمة مهام

- [x] db-username-whatsapp
- [x] register-api
- [x] telegram-approval-only
- [x] auth-form-ui
- [x] user-dashboard
- [x] landing-page
- [x] admin-profile-display
- [x] deploy-verify
