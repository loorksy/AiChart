import { BRAND_NAME } from "@/lib/brand";

export const LANDING = {
  brand: BRAND_NAME,
  tagline: "منصة تداول ذكية — Claude MCP · MetaTrader 5",
  hero: {
    title: "تداول بذكاء عبر Claude MCP",
    subtitle:
      "اربط Claude Connectors بحسابك، راقب السوق، ونفّذ الصفقات عبر MetaTrader — مع Risk Guard وموافقة إدارية.",
    ctaPrimary: "ابدأ مجاناً",
    ctaSecondary: "تسجيل الدخول",
    chatTitle: "ماذا ستتداول اليوم؟",
    chatSubtitle: "جرب سؤالاً — سجّل لربط Claude MCP والتداول الحقيقي.",
  },
  features: {
    title: "مزايا المنصة",
    items: [
      {
        title: "Claude MCP",
        desc: "أدوات تداول مباشرة داخل محادثة Claude — بدون واجهة معقدة.",
      },
      {
        title: "Risk Guard",
        desc: "حدود رأس المال، سقف الصفقات، وKill Switch قبل أي تنفيذ.",
      },
      {
        title: "MetaTrader 5",
        desc: "فوركس عبر EA على MetaTrader 5 أو MetaApi — تنفيذ مباشر من المحادثة.",
      },
      {
        title: "Telegram",
        desc: "تنبيهات وموافقات ولوحة عربية للمشغّل.",
      },
      {
        title: "ديمو / حقيقي",
        desc: "ابدأ على حساب MT5 تجريبي قبل الانتقال للحقيقي.",
      },
      {
        title: "صلاحية زمنية",
        desc: "حسابك مع تفعيل وتجديد من الإدارة — 30 يوم افتراضياً.",
      },
    ],
  },
  how: {
    title: "كيف يعمل",
    steps: [
      { n: "1", title: "سجّل", desc: "اسم مستخدم، واتساب، بريد، وكلمة مرور — أو Telegram." },
      { n: "2", title: "موافقة", desc: "الإدارة تفعّل حسابك وتمنح صلاحية الوصول." },
      { n: "3", title: "اربط Claude", desc: `أضف ${BRAND_NAME} كـ MCP Connector في Claude.` },
      { n: "4", title: "تداول", desc: "اربط MetaTrader وابدأ بقراراتك — التنفيذ محمي." },
    ],
  },
  integrations: {
    title: "تكاملات",
    items: ["Claude MCP", "MetaTrader 5 / EA", "MetaApi", "Telegram"],
  },
  security: {
    title: "ثقة وحماية",
    items: [
      "موافقة إدارية قبل التفعيل",
      "صلاحية زمنية قابلة للتجديد",
      "حدود مخاطر لكل مستخدم",
      "سجل تدقيق للعمليات الحساسة",
    ],
  },
  access: {
    title: "نموذج الوصول",
    desc: "التسجيل مفتوح، التفعيل بعد موافقة الإدارة. لا وعود ربح — أدوات تعليمية واحترافية.",
  },
  faq: {
    title: "أسئلة شائعة",
    items: [
      {
        q: "هل أحتاج Claude Pro؟",
        a: "تحتاج حساب Claude يدعم Connectors. ربط MCP يتم من إعدادات Claude.",
      },
      {
        q: "متى أستطيع التداول؟",
        a: "بعد موافقة الإدارة وتفعيل صلاحيتك — ستصلك لوحة المستخدم ودليل MCP.",
      },
      {
        q: "هل Telegram بديل عن البريد؟",
        a: "Telegram للتسجيل السريع؛ الدخول اليومي عبر البريد وكلمة المرور. بعد الموافقة يمكن إكمال الملف.",
      },
      {
        q: "هل يوجد حساب تجريبي؟",
        a: "نعم — حساب MT5 تجريبي مدعوم قبل التداول الحقيقي.",
      },
    ],
  },
  cta: {
    title: "جاهز للبدء؟",
    subtitle: "سجّل الآن — الإدارة تراجع طلبك وتفعّل حسابك.",
    button: "إنشاء حساب",
  },
  footer: {
    disclaimer: "للأغراض التعليمية — التداول ينطوي على مخاطر. لا ضمان للأرباح.",
    links: [
      { label: "تسجيل", href: "/signup" },
      { label: "دخول", href: "/login" },
    ],
  },
  nav: [
    { label: "المزايا", href: "#features" },
    { label: "كيف يعمل", href: "#how" },
    { label: "الأسئلة", href: "#faq" },
  ],
} as const;
