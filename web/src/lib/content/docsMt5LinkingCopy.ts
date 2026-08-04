/** Shared MT5 linking copy — seedContent, DB migrations, and UI must stay aligned. */

export const DOCS_MT5_LINKING_CONTENT_AR = `## ربط MT5

من باقة PLUS فما فوق يمكنك ربط حساب MT5 الحقيقي (من **لوحة التحكم ← ربط MT5**):

1. ابحث عن وسيطك أو أدخل اسم الخادم يدوياً.
2. سجّل دخولك بحساب MT5 الحقيقي — بياناتك تُخزَّن مشفَّرة AES-256.
3. بعد الربط يستخدم الوكيل اتصالك السحابي للتنفيذ والمراقبة عند طلبك — لا يُسحب تاريخ طويل تلقائياً إلى مستودع منفصل.

**توفير التكلفة تلقائي**: عند مغادرتك المنصة يُوقَف اتصال حسابك خلال 15 دقيقة ويعود وحده عند عودتك — ساعات الاتصال تُخصم من رصيدك بالدقيقة وتظهر في كشف حسابك. حسابات التنفيذ الحي الآلي (PRO فما فوق) تبقى متصلة دائماً.`;

export const DOCS_MT5_LINKING_CONTENT_EN = `## Linking MT5

From PLUS and above you can link your real MT5 account (**Console → Link MT5**):

1. Search for your broker or type the server name manually.
2. Sign in with your real MT5 credentials — stored AES-256 encrypted.
3. After linking the agent uses your cloud connection for execution and monitoring when you ask — we do not bulk-import a year of history into a warehouse on connect.

**Automatic cost saving**: when you leave the platform your account connection pauses within 15 minutes and returns by itself when you're back — connection hours are deducted from your credit by the minute and appear in your statement. Live auto-execution accounts (PRO+) stay connected around the clock.`;

/** Legacy seeded copy promised a one-year warehouse backfill that no longer runs. */
export const DOCS_MT5_LINKING_STALE_MARKERS = [
  "سنة كاملة من البيانات التاريخية",
  "full year of history is pulled once",
] as const;

export const MT5_CONNECT_SUCCESS_STATUS =
  "تم الربط! حسابك السحابي جاهز — الوكيل يمكنه التنفيذ والمراقبة عند طلبك.";
