/** Shared MT5 linking copy — seedContent, DB migrations, and UI must stay aligned. */

export const DOCS_MT5_LINKING_CONTENT_AR = `## ربط MT5

ربط حسابك لدى الوسيط هو الخطوة الأولى في المنصة — كل البيانات الحية تأتي من حسابك أنت (من **لوحة التحكم ← ربط MT5**):

1. ابحث عن وسيطك بالاسم — تماماً كما في تطبيق MT5 الرسمي — ثم اختر السيرفر من القائمة، أو أدخله يدوياً.
2. سجّل دخولك بحساب MT5 الحقيقي — بياناتك تُخزَّن مشفَّرة AES-256.
3. بعد الربط يستخدم الوكيل اتصالك السحابي للأسعار والتنفيذ والمراقبة عند طلبك — لا يُسحب تاريخ طويل تلقائياً إلى مستودع منفصل.

في التجربة المجانية تبدأ ساعتك المجانية من أول ربط ناجح.

**توفير التكلفة تلقائي**: عند مغادرتك المنصة يُوقَف اتصال حسابك خلال 15 دقيقة ويعود وحده عند عودتك — ساعات الاتصال تُخصم من رصيدك بالدقيقة وتظهر في كشف حسابك. حسابات التنفيذ الحي الآلي تبقى متصلة دائماً.`;

export const DOCS_MT5_LINKING_CONTENT_EN = `## Linking MT5

Linking your broker account is the platform's first step — all live data comes from YOUR account (**Console → Link MT5**):

1. Search for your broker by name — exactly like the official MT5 app — then pick the server from the list, or type it manually.
2. Sign in with your real MT5 credentials — stored AES-256 encrypted.
3. After linking the agent uses your cloud connection for prices, execution and monitoring when you ask — we do not bulk-import a year of history into a warehouse on connect.

On the free trial, your free hour starts at the first successful link.

**Automatic cost saving**: when you leave the platform your account connection pauses within 15 minutes and returns by itself when you're back — connection hours are deducted from your credit by the minute and appear in your statement. Live auto-execution accounts stay connected around the clock.`;

/**
 * Seeded copy that must be replaced in existing databases: the original
 * one-year-warehouse promise, then the four-tier (PLUS/PRO) gating that the
 * single-plan collapse removed.
 */
export const DOCS_MT5_LINKING_STALE_MARKERS = [
  "سنة كاملة من البيانات التاريخية",
  "full year of history is pulled once",
  "من باقة PLUS فما فوق",
  "From PLUS and above",
] as const;

export const MT5_CONNECT_SUCCESS_STATUS =
  "تم الربط! حسابك السحابي جاهز — الوكيل يمكنه التنفيذ والمراقبة عند طلبك.";
