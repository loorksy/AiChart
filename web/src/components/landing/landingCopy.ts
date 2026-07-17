import { BRAND_NAME } from "@/lib/brand";
import type { AppLocale } from "@/lib/i18n/types";

/** Real public routes used by landing CTAs and footer — keep in sync with app routes. */
export const LANDING_ROUTES = {
  home: "/",
  signup: "/signup",
  login: "/login",
  chart: "/chart",
  console: "/console",
  privacy: "/p/privacy-policy",
  terms: "/p/terms-of-service",
  agreement: "/p/user-agreement",
  risk: "/p/risk-disclosure",
  about: "/p/about-us",
  contact: "/p/contact-us",
} as const;

export type LandingCopy = {
  nav: {
    features: string;
    how: string;
    trust: string;
    faq: string;
    signIn: string;
    primaryCta: string;
    openMenu: string;
    closeMenu: string;
    theme: string;
    language: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
  };
  preview: {
    label: string;
    chartPane: string;
    chatPane: string;
    agentGreeting: string;
    recommendationTitle: string;
    side: string;
    entry: string;
    stop: string;
    target: string;
    status: string;
    statusValue: string;
    illustrative: string;
  };
  benefits: {
    title: string;
    subtitle: string;
    items: { title: string; body: string }[];
  };
  how: {
    title: string;
    subtitle: string;
    steps: { n: string; title: string; body: string }[];
  };
  workspace: {
    title: string;
    subtitle: string;
    points: string[];
  };
  trust: {
    title: string;
    subtitle: string;
    items: string[];
    riskNote: string;
  };
  integrations: {
    title: string;
    subtitle: string;
    items: { name: string; availability: string }[];
  };
  history: {
    title: string;
    body: string;
    disclaimer: string;
  };
  faq: {
    title: string;
    items: { q: string; a: string }[];
  };
  cta: {
    title: string;
    subtitle: string;
    primary: string;
    secondary: string;
  };
  footer: {
    blurb: string;
    product: string;
    legal: string;
    company: string;
    openPlatform: string;
    features: string;
    how: string;
    privacy: string;
    terms: string;
    agreement: string;
    risk: string;
    about: string;
    contact: string;
    disclaimer: string;
    rights: string;
  };
};

const ar: LandingCopy = {
  nav: {
    features: "المزايا",
    how: "كيف يعمل",
    trust: "الثقة",
    faq: "الأسئلة",
    signIn: "تسجيل الدخول",
    primaryCta: "ابدأ مجاناً",
    openMenu: "فتح القائمة",
    closeMenu: "إغلاق القائمة",
    theme: "المظهر",
    language: "اللغة",
  },
  hero: {
    eyebrow: "مساحة تداول بالذكاء الاصطناعي",
    title: "حلّل السوق، ناقش الفرصة، ونفّذ بوضوح.",
    subtitle:
      "يجمع AiChart بين الشارت الحي ومحادثة تداول ذكية، ثم يجهّز سيناريوهات واضحة للمراجعة قبل التنفيذ عبر MetaTrader.",
    primaryCta: "افتح AiChart",
    secondaryCta: "جرّب الشارت",
  },
  preview: {
    label: "معاينة مساحة العمل",
    chartPane: "الشارت",
    chatPane: "المحادثة",
    agentGreeting: "جاهز لمراجعة EURUSD على إطار 15 دقيقة بهدوء.",
    recommendationTitle: "سيناريو توضيحي",
    side: "WAIT",
    entry: "الدخول",
    stop: "وقف الخسارة",
    target: "الهدف",
    status: "الحالة",
    statusValue: "بانتظار تأكيد الهيكل",
    illustrative: "بيانات توضيحية — ليست توصية حية",
  },
  benefits: {
    title: "ثلاثة أسباب لاختيار AiChart",
    subtitle: "تركيز على التجربة الحقيقية: شارت، محادثة، وتنفيذ مضبوط.",
    items: [
      {
        title: "الشارت والمحادثة معاً",
        body: "تناقش الرمز والإطار الزمني الحاليين بينما يبقى سياق الشارت واضحاً أمامك.",
      },
      {
        title: "سيناريوهات تداول واضحة",
        body: "عند وجود مبرر كافٍ، يقدّم AiChart BUY أو SELL أو WAIT أو سيناريو مشروطاً مع الأسباب والمستويات.",
      },
      {
        title: "تنفيذ MetaTrader بموافقتك",
        body: "لا يُرسل أمر حي إلا بعد موافقتك الصريحة واجتياز الفحوص التقنية الصالحة.",
      },
    ],
  },
  how: {
    title: "كيف يعمل",
    subtitle: "ثلاث خطوات بسيطة من فتح السوق إلى التنفيذ.",
    steps: [
      {
        n: "1",
        title: "افتح السوق",
        body: "اختر الرمز والإطار الزمني، أو تابع من الشارت الحالي.",
      },
      {
        n: "2",
        title: "ناقش وراجع",
        body: "اطلب تحليلاً أو فرصة أو مستويات مهمة، ثم راجع السيناريو المقترح.",
      },
      {
        n: "3",
        title: "وافق على التنفيذ",
        body: "نفّذ عبر حساب MetaTrader المرتبط فقط عندما تكون جاهزاً.",
      },
    ],
  },
  workspace: {
    title: "مساحة عمل واحدة",
    subtitle: "كل ما تحتاجه للمراجعة اليومية في مكان واحد.",
    points: [
      "شارت حي مع الرمز والإطار الزمني",
      "محادثة مع وكيل AiChart",
      "بطاقة توصية بمستويات الدخول والوقف والأهداف",
      "سجل المحادثات والإحصائيات والصفقات",
    ],
  },
  trust: {
    title: "ثقة وتنفيذ مضبوط",
    subtitle: "حماية عملية تهمّ المتداول — دون ادعاء ضمان النتيجة.",
    items: [
      "موافقة صريحة قبل أي تنفيذ",
      "بيانات سوق حالية وصالحة عند التنفيذ",
      "ربط حساب موثّق بملكيتك",
      "منع التنفيذ المكرر عند الإمكان",
      "حالة واضحة للتوصية وسجل تاريخي للمراجعة",
    ],
    riskNote:
      "Risk per Trade يضبط حجم الصفقة فقط؛ ولا يفرض قرار السوق BUY أو SELL أو WAIT.",
  },
  integrations: {
    title: "تكاملات حقيقية",
    subtitle: "ما هو متاح فعلياً في المنصة اليوم.",
    items: [
      { name: "MetaTrader 5 / EA", availability: "متاح بعد الربط" },
      { name: "MetaApi", availability: "اختياري" },
      { name: "Telegram", availability: "اختياري للتنبيهات" },
      { name: "MCP", availability: "للمستخدمين المصرّح لهم" },
    ],
  },
  history: {
    title: "مراجعة تاريخية",
    body: "بعد التسجيل يمكنك مراجعة التوصيات والنتائج المخزّنة في حسابك — من داخل المنصة وليس كأرقام تسويقية عامة.",
    disclaimer: "الأداء السابق لا يضمن النتائج المستقبلية.",
  },
  faq: {
    title: "أسئلة شائعة",
    items: [
      {
        q: "هل ينفّذ AiChart الصفقات تلقائياً؟",
        a: "لا. التنفيذ الحي يتطلب موافقتك الصريحة، ثم فحوصاً تقنية صالحة قبل إرسال الأمر.",
      },
      {
        q: "هل أحتاج MetaTrader؟",
        a: "للتنفيذ الحي نعم تحتاج حساب MetaTrader مرتبطاً. يمكنك فتح الشارت ومناقشة السوق دون تنفيذ.",
      },
      {
        q: "هل يمكنني استخدام الشارت دون ربط حساب؟",
        a: "نعم. الشارت العام متاح للتصفح. الربط مطلوب للتنفيذ والمزامنة مع حسابك.",
      },
      {
        q: "ماذا يتحكم فيه Risk per Trade؟",
        a: "حجم الصفقة فقط بالنسبة لرصيدك ومسافة وقف الخسارة. لا يغيّر قرار السوق.",
      },
      {
        q: "هل يضمن AiChart الربح؟",
        a: "لا. التداول ينطوي على مخاطر. AiChart أداة للمراجعة واتخاذ القرار — وليست نظام ربح مضمون.",
      },
      {
        q: "هل العربية والإنجليزية مدعومتان؟",
        a: "نعم. يمكنك التبديل بين العربية والإنجليزية من الواجهة.",
      },
      {
        q: "كيف يُربط حسابي؟",
        a: "بعد التسجيل وتفعيل الوصول، تربط MetaTrader من داخل المنصة وفق الدليل المعروض لحسابك.",
      },
    ],
  },
  cta: {
    title: "افتح الشارت وابدأ أول محادثة سوقية.",
    subtitle: "سجّل للبدء، أو سجّل الدخول إن كان لديك حساب.",
    primary: "ابدأ مجاناً",
    secondary: "لدي حساب — تسجيل الدخول",
  },
  footer: {
    blurb: `${BRAND_NAME} — مساحة عمل تجمع الشارت والمحادثة والتوصيات والتنفيذ عبر MetaTrader.`,
    product: "المنتج",
    legal: "قانوني",
    company: "الشركة",
    openPlatform: "افتح المنصة",
    features: "المزايا",
    how: "كيف يعمل",
    privacy: "سياسة الخصوصية",
    terms: "الشروط",
    agreement: "اتفاقية المستخدم",
    risk: "إفصاح المخاطر",
    about: "من نحن",
    contact: "تواصل معنا",
    disclaimer:
      "التداول ينطوي على مخاطر وقد تخسر رأس المال. لا ضمان للأرباح. راجع إفصاح المخاطر قبل الاستخدام.",
    rights: `© ${new Date().getFullYear()} ${BRAND_NAME}`,
  },
};

const en: LandingCopy = {
  nav: {
    features: "Features",
    how: "How it works",
    trust: "Trust",
    faq: "FAQ",
    signIn: "Sign in",
    primaryCta: "Start free",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    theme: "Theme",
    language: "Language",
  },
  hero: {
    eyebrow: "AI trading workspace",
    title: "Analyze the market. Discuss the setup. Execute with clarity.",
    subtitle:
      "AiChart combines a live chart with an intelligent trading conversation, then prepares clear trade scenarios for review before MetaTrader execution.",
    primaryCta: "Open AiChart",
    secondaryCta: "View the chart",
  },
  preview: {
    label: "Workspace preview",
    chartPane: "Chart",
    chatPane: "Chat",
    agentGreeting: "Ready to review EURUSD on the 15-minute chart calmly.",
    recommendationTitle: "Illustrative scenario",
    side: "WAIT",
    entry: "Entry",
    stop: "Stop loss",
    target: "Target",
    status: "Status",
    statusValue: "Waiting for structure confirmation",
    illustrative: "Illustrative data — not a live recommendation",
  },
  benefits: {
    title: "Three reasons to use AiChart",
    subtitle: "Focused on the real workflow: chart, conversation, and controlled execution.",
    items: [
      {
        title: "Chart and conversation together",
        body: "Discuss the selected symbol and timeframe while chart context stays visible.",
      },
      {
        title: "Clear trading scenarios",
        body: "When justified, AiChart offers BUY, SELL, WAIT, or a conditional scenario with reasoning and real levels.",
      },
      {
        title: "Controlled MetaTrader execution",
        body: "Live orders are sent only after your explicit approval and valid technical checks.",
      },
    ],
  },
  how: {
    title: "How it works",
    subtitle: "Three simple steps from opening the market to execution.",
    steps: [
      {
        n: "1",
        title: "Open the market",
        body: "Choose the symbol and timeframe, or continue from the current chart.",
      },
      {
        n: "2",
        title: "Discuss and review",
        body: "Ask for analysis, opportunity, or key levels, then review the proposed scenario.",
      },
      {
        n: "3",
        title: "Approve execution",
        body: "Execute through your connected MetaTrader account only when you are ready.",
      },
    ],
  },
  workspace: {
    title: "One workspace",
    subtitle: "Everything you need for daily review in one place.",
    points: [
      "Live chart with symbol and timeframe",
      "Conversation with the AiChart agent",
      "Recommendation card with entry, stop, and targets",
      "Conversation history, statistics, and trades",
    ],
  },
  trust: {
    title: "Trust and execution safety",
    subtitle: "Practical safeguards for traders — without promising outcomes.",
    items: [
      "Explicit approval before any execution",
      "Current valid market data at execution time",
      "Authenticated account ownership",
      "Duplicate-execution prevention where applicable",
      "Clear recommendation status and historical review",
    ],
    riskNote:
      "Risk per Trade controls position size only; it does not force the market decision BUY, SELL, or WAIT.",
  },
  integrations: {
    title: "Real integrations",
    subtitle: "What the platform actually supports today.",
    items: [
      { name: "MetaTrader 5 / EA", availability: "Available after connection" },
      { name: "MetaApi", availability: "Optional" },
      { name: "Telegram", availability: "Optional for alerts" },
      { name: "MCP", availability: "Authorized technical use" },
    ],
  },
  history: {
    title: "Historical review",
    body: "Registered users can review stored recommendations and outcomes inside their account — not as public marketing metrics.",
    disclaimer: "Past performance does not guarantee future results.",
  },
  faq: {
    title: "FAQ",
    items: [
      {
        q: "Does AiChart execute trades automatically?",
        a: "No. Live execution requires your explicit approval and valid technical checks before an order is sent.",
      },
      {
        q: "Do I need MetaTrader?",
        a: "For live execution, yes — a connected MetaTrader account. You can open the chart and discuss the market without executing.",
      },
      {
        q: "Can I use the chart without connecting an account?",
        a: "Yes. The public chart is available for browsing. Connection is required for execution and account sync.",
      },
      {
        q: "What does Risk per Trade control?",
        a: "Position size only, based on your equity and stop distance. It does not change the market decision.",
      },
      {
        q: "Does AiChart guarantee profit?",
        a: "No. Trading involves risk. AiChart is a review and decision workspace — not a guaranteed profit system.",
      },
      {
        q: "Are Arabic and English supported?",
        a: "Yes. You can switch between Arabic and English in the interface.",
      },
      {
        q: "How is my account connected?",
        a: "After registration and access activation, connect MetaTrader from inside the platform using the guide shown for your account.",
      },
    ],
  },
  cta: {
    title: "Open the chart and start your first market conversation.",
    subtitle: "Create an account to begin, or sign in if you already have one.",
    primary: "Start free",
    secondary: "I have an account — Sign in",
  },
  footer: {
    blurb: `${BRAND_NAME} — a workspace that combines chart, conversation, recommendations, and MetaTrader execution.`,
    product: "Product",
    legal: "Legal",
    company: "Company",
    openPlatform: "Open platform",
    features: "Features",
    how: "How it works",
    privacy: "Privacy Policy",
    terms: "Terms",
    agreement: "User Agreement",
    risk: "Risk Disclaimer",
    about: "About",
    contact: "Contact",
    disclaimer:
      "Trading involves risk and you may lose capital. No profit is guaranteed. Read the risk disclosure before use.",
    rights: `© ${new Date().getFullYear()} ${BRAND_NAME}`,
  },
};

export function getLandingCopy(locale: AppLocale): LandingCopy {
  return locale === "en" ? en : ar;
}

/** All hrefs that must resolve to real app routes or in-page anchors. */
export const LANDING_CTA_HREFS = [
  LANDING_ROUTES.signup,
  LANDING_ROUTES.login,
  LANDING_ROUTES.chart,
  LANDING_ROUTES.privacy,
  LANDING_ROUTES.terms,
  LANDING_ROUTES.agreement,
  LANDING_ROUTES.risk,
  LANDING_ROUTES.about,
  LANDING_ROUTES.contact,
  "#features",
  "#how",
  "#trust",
  "#faq",
] as const;
