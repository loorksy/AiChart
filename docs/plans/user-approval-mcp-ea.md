# موافقة الأدmin للمستخدمين + MCP + تحميل EA

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/user_approval_mcp_ea_9f9ab3a2.plan.md`](./originals/user_approval_mcp_ea_9f9ab3a2.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| `access_expires_at` | migration + `platformAccess.ts` |
| تسجيل متعدد المستخدمين | `AICHART_SINGLE_USER=0` |
| صفحة awaiting-approval | `/awaiting-approval` |
| أدmin — موافقة 30 يوم | `AdminUsersTable`, `PlatformSection` |
| MCP login مرتبط بالصلاحية | `mcp-auth/verify`, JWT TTL |
| تحميل EA | `GET /api/ea/download` + `EaConnectCard` |

## الهدف

تسجيل عام → قفل الكونسول/MCP/EA حتى موافقة الأدmin بصلاحية زمنية.

## قائمة مهام

- [x] db-access-expires
- [x] enable-registration
- [x] console-gate
- [x] admin-approve-ui
- [x] mcp-verify-users
- [x] ea-download
- [x] deploy-verify
