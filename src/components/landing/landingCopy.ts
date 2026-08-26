import { BRAND_NAME } from "@/lib/brand";
import type { AppLocale } from "@/lib/i18n/types";

/** Real public routes used by landing CTAs and footer — keep in sync with app routes. */
export const LANDING_ROUTES = {
  home: "/",
  signup: "/signup",
  login: "/login",
  // The product is the chat surface; there is no standalone chart page and no
  // CMS-backed legal pages any more, so every marketing CTA lands on a route
  // that actually exists.
  chart: "/chat",
  console: "/chat",
  pricing: "/signup",
  privacy: "/privacy",
  terms: "/privacy",
  agreement: "/privacy",
  risk: "/privacy",
  about: "/",
  contact: "/",
} as const;

export type LandingCopy = {
  nav: {
    features: string;
    how: string;
    trust: string;
    faq: string;
    stats: string;
    pricing: string;
    signIn: string;
    primaryCta: string;
    openMenu: string;
    closeMenu: string;
    theme: string;
    language: string;
    skip: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
    quickPrompts: string[];
    highlights: {
      icon: "chart" | "chat" | "approval";
      label: string;
      detail: string;
    }[];
  };
  partners: {
    eyebrow: string;
    note: string;
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
    workspaceLabel: string;
    workspacePoints: string[];
    panelTitle: string;
    panelBody: string;
    panelCta: string;
    executionLabel: string;
    executionTitle: string;
    executionBody: string;
    executionBadge: string;
  };
  stats: {
    title: string;
    subtitle: string;
    disclaimer: string;
    items: {
      eyebrow: string;
      value: string;
      title: string;
      body: string;
      note: string;
      linkLabel: string;
      href: string;
      icon: "chart" | "approval" | "trial";
    }[];
  };
  testimonials: {
    title: string;
    subtitle: string;
    disclaimer: string;
    items: {
      quote: string;
      name: string;
      role: string;
      initials: string;
    }[];
  };
  pricing: {
    eyebrow: string;
    title: string;
    subtitle: string;
    perMonth: string;
    creditsPrefix: string;
    highlightBadge: string;
    modelsAll: string;
    modelsCount: string;
    featureLabels: Record<
      "telegramBot" | "trackedRecommendations" | "voice" | "scalpEngine" | "prioritySupport",
      string
    >;
    cta: string;
    contactCta: string;
    ctaNote: string;
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
    subtitle: string;
    contactLead: string;
    contactLink: string;
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
    stats: "حقائق",
    pricing: "الأسعار",
    signIn: "تسجيل الدخول",
    primaryCta: "ابدأ مجاناً",
    openMenu: "فتح القائمة",
    closeMenu: "إغلاق القائمة",
    theme: "المظهر",
    language: "اللغة",
    skip: "تخطَّ إلى المحتوى",
  },
  hero: {
    eyebrow: "مساحة تداول بالذكاء الاصطناعي",
    title: "حلّل الذهب، ناقش الفرصة، وخذ توصية واضحة.",
    subtitle:
      "يجمع Lonora بين الشارت الحي ومحادثة ذكية متخصصة في الذهب، ثم يقدّم توصيات بمستويات واضحة تمر عبر فحوص إلزامية وتُتابَع حتى نتيجتها.",
    primaryCta: "افتح Lonora",
    secondaryCta: "افتح مساحة العمل",
    quickPrompts: [
      "حلّل الذهب الآن",
      "اقترح فرصة تداول مدروسة",
      "راجع مستويات الدخول الحالية",
    ],
    highlights: [
      {
        icon: "chart",
        label: "شارت حي",
        detail: "الرمز والإطار الزمني يبقيان أمامك أثناء المحادثة.",
      },
      {
        icon: "chat",
        label: "محادثة سوقية",
        detail: "اطلب تحليلاً أو فرصة أو مستويات مهمة بصياغة طبيعية.",
      },
      {
        icon: "approval",
        label: "توصيات، لا أوامر",
        detail: "المنصة لا تنفّذ صفقات إطلاقاً — القرار والتنفيذ بيدك وحدك.",
      },
    ],
  },
  partners: {
    eyebrow: "تكاملات وشركاء تقنيون",
    note: "شعارات توضيحية للتكاملات المدعومة أو المستخدمة في مساحة Lonora — وليست ادّعاء شراكة تجارية.",
  },
  preview: {
    label: "معاينة مساحة العمل",
    chartPane: "الشارت",
    chatPane: "المحادثة",
    agentGreeting: "جاهز لمراجعة الذهب على إطار 15 دقيقة بهدوء.",
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
    title: "ثلاثة أسباب لاختيار Lonora",
    subtitle: "تركيز على التجربة الحقيقية: شارت، محادثة، وتوصيات خاضعة للفحص.",
    items: [
      {
        title: "الشارت والمحادثة معاً",
        body: "تناقش الرمز والإطار الزمني الحاليين بينما يبقى سياق الشارت واضحاً أمامك.",
      },
      {
        title: "سيناريوهات تداول واضحة",
        body: "عند وجود مبرر كافٍ، يقدّم Lonora BUY أو SELL أو WAIT أو سيناريو مشروطاً مع الأسباب والمستويات.",
      },
      {
        title: "توصيات تُتابَع حتى النهاية",
        body: "كل توصية تُخزَّن وتُقاس على شموع السوق حتى تبلغ هدفها أو وقفها — النتيجة تُسجَّل كما حدثت.",
      },
    ],
    workspaceLabel: "مساحة العمل",
    workspacePoints: [
      "شارت حي مع الرمز والإطار الزمني",
      "محادثة مع وكيل Lonora",
      "بطاقة توصية بمستويات الدخول والوقف والأهداف",
    ],
    panelTitle: "معاينة توضيحية",
    panelBody: "شاهد كيف تبدو مساحة العمل قبل التسجيل — بيانات توضيحية وليست توصية حية.",
    panelCta: "افتح مساحة العمل",
    executionLabel: "قرار السوق",
    executionTitle: "BUY · SELL · WAIT بقرار واحد واضح",
    executionBody:
      "Risk per Trade يضبط حجم الصفقة فقط ولا يغيّر قرار السوق.",
    executionBadge: "النتيجة",
  },
  stats: {
    title: "أرقام المنتج — لا أرقام تسويقية",
    subtitle: "حقائق تشغيلية عن Lonora، وليست ادّعاءات أداء.",
    disclaimer: "هذه الأرقام تصف قدرات المنصة الحالية، وليست نتائج تداول.",
    items: [
      {
        eyebrow: "تجربة",
        value: "3",
        title: "تفاعلات مجانية",
        body: "عدد التفاعلات المجانية المتاحة في التجربة قبل التفعيل اليدوي.",
        note: "بدون ادّعاء مدة فوترة",
        linkLabel: "ابدأ",
        href: LANDING_ROUTES.signup,
        icon: "trial",
      },
      {
        eyebrow: "قرار",
        value: "3",
        title: "نتائج واضحة",
        body: "BUY أو SELL أو WAIT — قرار واحد مع أسباب ومستويات عند توفرها.",
        note: "توصيات فقط — لا تنفيذ",
        linkLabel: "كيف يعمل",
        href: "#how",
        icon: "approval",
      },
      {
        eyebrow: "مساحة",
        value: "1",
        title: "مساحة عمل موحّدة",
        body: "شارت، محادثة، توصيات، وسجل في واجهة واحدة.",
        note: "عربي وإنجليزي",
        linkLabel: "المزايا",
        href: "#features",
        icon: "chart",
      },
    ],
  },
  testimonials: {
    title: "آراء توضيحية عن سير العمل",
    subtitle: "سيناريوهات استخدام شائعة — وليست شهادات أداء.",
    disclaimer: "أسماء واقتباسات توضيحية لشرح تجربة المنتج، وليست نتائج مضمونة.",
    items: [
      {
        quote:
          "أخيراً أرى الشارت والمحادثة معاً بدل التنقل بين نوافذ متفرقة.",
        name: "مراجع A",
        role: "سيناريو توضيحي — متداول فوركس",
        initials: "A",
      },
      {
        quote:
          "أحب أن كل توصية تمر عبر فحوص واضحة، وإذا رفضتها الفحوص يخبرني لماذا بالاسم.",
        name: "مراجع B",
        role: "سيناريو توضيحي — متداول ذهب",
        initials: "B",
      },
      {
        quote:
          "WAIT كقرار واضح أفضل لي من إشارات BUY/SELL متسرعة بدون سياق.",
        name: "مراجع C",
        role: "سيناريو توضيحي — مراجعة يومية",
        initials: "C",
      },
      {
        quote:
          "التبديل بين العربية والإنجليزية يجعل المراجعة أسهل مع فريق مختلط.",
        name: "مراجع D",
        role: "سيناريو توضيحي — فريق صغير",
        initials: "D",
      },
      {
        quote:
          "بطاقة التوصية بمستويات الدخول والوقف أوضح من نص طويل في الدردشة.",
        name: "مراجع E",
        role: "سيناريو توضيحي — سكالبينج",
        initials: "E",
      },
      {
        quote:
          "أستخدم توصيات Lonora كرأي ثانٍ منضبط — القرار الأخير يبقى لي دائماً.",
        name: "مراجع F",
        role: "سيناريو توضيحي — إدارة مخاطر",
        initials: "F",
      },
    ],
  },
  pricing: {
    eyebrow: "الأسعار",
    title: "باقة واحدة، كل الميزات",
    subtitle:
      "كل باقة تمنحك رصيد استخدام شهرياً يُستهلك حسب استخدامك الفعلي. الأسعار هنا من المصدر نفسه الذي يقرأه نظام الفوترة.",
    perMonth: "/شهرياً",
    creditsPrefix: "رصيد استخدام شهري",
    highlightBadge: "الأكثر اختياراً",
    modelsAll: "كل مودلات الذكاء الاصطناعي",
    modelsCount: "مودلات ذكاء اصطناعي",
    featureLabels: {
      telegramBot: "وكيل التوصيات عبر تليجرام",
      trackedRecommendations: "تتبّع كل توصية حتى نتيجتها",
      voice: "الوكيل الصوتي",
      scalpEngine: "محرك السكالب الآلي",
      prioritySupport: "أولوية الدعم",
    },
    cta: "قارن الباقات كاملة",
    contactCta: "تواصل عبر Telegram",
    ctaNote: "التفاصيل الكاملة والأسئلة الشائعة في صفحة الأسعار.",
  },
  how: {
    title: "كيف يعمل",
    subtitle: "ثلاث خطوات بسيطة من السؤال إلى توصية مكتملة.",
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
        title: "خذ التوصية وتابعها",
        body: "تصلك توصية بدخول ووقف وأهداف، وتُتابَع تلقائياً حتى نتيجتها — التنفيذ قرارك أنت خارج المنصة.",
      },
    ],
  },
  workspace: {
    title: "مساحة عمل واحدة",
    subtitle: "كل ما تحتاجه للمراجعة اليومية في مكان واحد.",
    points: [
      "شارت حي مع الرمز والإطار الزمني",
      "محادثة مع وكيل Lonora",
      "بطاقة توصية بمستويات الدخول والوقف والأهداف",
      "سجل المحادثات والتوصيات ونتائجها",
    ],
  },
  trust: {
    title: "ثقة وشفافية",
    subtitle: "حماية عملية تهمّ المتداول — دون ادعاء ضمان النتيجة.",
    items: [
      "المنصة لا تنفّذ صفقات — توصيات فقط، والقرار لك",
      "بيانات سوق حية من OANDA خلف كل توصية",
      "فحوص إلزامية (أخبار، سيولة، بنية، أدلة) قد ترفض التوصية وتسمّي السبب",
      "كل توصية تُتابَع حتى نتيجتها النهائية كما حدثت",
      "حالة واضحة للتوصية وسجل تاريخي للمراجعة",
    ],
    riskNote:
      "Risk per Trade يضبط حجم الصفقة فقط؛ ولا يفرض قرار السوق BUY أو SELL أو WAIT.",
  },
  integrations: {
    title: "تكاملات حقيقية",
    subtitle: "ما هو متاح فعلياً في المنصة اليوم.",
    items: [
      { name: "OANDA", availability: "مصدر بيانات السوق" },
      { name: "Telegram", availability: "وكيل توصيات كامل" },
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
    subtitle: "إجابات مختصرة عن Lonora والتوصيات واللغات المدعومة.",
    contactLead: "لم تجد إجابتك؟",
    contactLink: "تواصل معنا",
    items: [
      {
        q: "هل ينفّذ Lonora الصفقات؟",
        a: "لا، إطلاقاً — لا تلقائياً ولا بموافقة. Lonora يقدّم توصيات مشروحة بمستوياتها، والتنفيذ قرارك على منصتك الخاصة.",
      },
      {
        q: "هل أحتاج حساب وساطة أو MetaTrader؟",
        a: "لا. لا حاجة لأي ربط وساطة — تسجّل وتحصل على التوصيات مباشرة، وبيانات السوق من OANDA.",
      },
      {
        q: "هل يمكنني استخدام الشارت دون أي ربط خارجي؟",
        a: "نعم. الشارت والمحادثة والتوصيات كلها تعمل بحسابك في المنصة فقط.",
      },
      {
        q: "ماذا يتحكم فيه Risk per Trade؟",
        a: "حجم الصفقة فقط بالنسبة لرصيدك ومسافة وقف الخسارة. لا يغيّر قرار السوق.",
      },
      {
        q: "هل يضمن Lonora الربح؟",
        a: "لا. التداول ينطوي على مخاطر. Lonora أداة للمراجعة واتخاذ القرار — وليست نظام ربح مضمون.",
      },
      {
        q: "هل العربية والإنجليزية مدعومتان؟",
        a: "نعم. يمكنك التبديل بين العربية والإنجليزية من الواجهة.",
      },
      {
        q: "كيف أستقبل التوصيات على تليجرام؟",
        a: "من إعدادات المنصة اضغط «ربط تليجرام» وافتح الرابط — يجيبك الوكيل نفسه هناك بالتحليل نفسه.",
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
    blurb: `${BRAND_NAME} — مساحة عمل تجمع الشارت والمحادثة وتوصيات الذهب المتابَعة حتى نتيجتها.`,
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
    stats: "Facts",
    pricing: "Pricing",
    signIn: "Sign in",
    primaryCta: "Start free",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    theme: "Theme",
    language: "Language",
    skip: "Skip to content",
  },
  hero: {
    eyebrow: "AI trading workspace",
    title: "Analyze gold. Discuss the setup. Get a clear recommendation.",
    subtitle:
      "Lonora pairs a live chart with an intelligent gold-focused conversation, then issues recommendations with clear levels — screened by mandatory checks and tracked to their outcome.",
    primaryCta: "Open Lonora",
    secondaryCta: "Open workspace",
    quickPrompts: [
      "Analyze gold now",
      "Suggest a well-founded trade idea",
      "Review the current entry levels",
    ],
    highlights: [
      {
        icon: "chart",
        label: "Live chart",
        detail: "Symbol and timeframe stay visible while you chat.",
      },
      {
        icon: "chat",
        label: "Market conversation",
        detail: "Ask for analysis, opportunity, or key levels in plain language.",
      },
      {
        icon: "approval",
        label: "Recommendations, never orders",
        detail: "The platform never places trades — the decision and execution stay yours.",
      },
    ],
  },
  partners: {
    eyebrow: "Integrations and technology partners",
    note: "Illustrative logos for supported or used integrations in Lonora — not a commercial partnership claim.",
  },
  preview: {
    label: "Workspace preview",
    chartPane: "Chart",
    chatPane: "Chat",
    agentGreeting: "Ready to review gold on the 15-minute chart calmly.",
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
    title: "Three reasons to use Lonora",
    subtitle: "Focused on the real workflow: chart, conversation, and checked recommendations.",
    items: [
      {
        title: "Chart and conversation together",
        body: "Discuss the selected symbol and timeframe while chart context stays visible.",
      },
      {
        title: "Clear trading scenarios",
        body: "When justified, Lonora offers BUY, SELL, WAIT, or a conditional scenario with reasoning and real levels.",
      },
      {
        title: "Recommendations tracked to the end",
        body: "Every recommendation is stored and measured against market candles until it hits its target or its stop — the outcome is recorded as it happened.",
      },
    ],
    workspaceLabel: "Workspace",
    workspacePoints: [
      "Live chart with symbol and timeframe",
      "Conversation with the Lonora agent",
      "Recommendation card with entry, stop, and targets",
    ],
    panelTitle: "Illustrative preview",
    panelBody: "See how the workspace feels before signup — illustrative data, not a live recommendation.",
    panelCta: "Open workspace",
    executionLabel: "Market decision",
    executionTitle: "BUY · SELL · WAIT in one clear outcome",
    executionBody:
      "Risk per Trade controls position size only and does not force the market decision.",
    executionBadge: "Outcome",
  },
  stats: {
    title: "Product facts — not marketing metrics",
    subtitle: "Operational truths about Lonora, not performance claims.",
    disclaimer: "These numbers describe current product capabilities, not trading results.",
    items: [
      {
        eyebrow: "Trial",
        value: "3",
        title: "Free interactions",
        body: "The number of free trial interactions before manual activation.",
        note: "No fabricated billing period",
        linkLabel: "Start",
        href: LANDING_ROUTES.signup,
        icon: "trial",
      },
      {
        eyebrow: "Decision",
        value: "3",
        title: "Clear outcomes",
        body: "Buy or sell — one direction, with the plan, the levels, and what invalidates it.",
        note: "Recommendations only — no execution",
        linkLabel: "How it works",
        href: "#how",
        icon: "approval",
      },
      {
        eyebrow: "Workspace",
        value: "1",
        title: "Unified workspace",
        body: "Chart, chat, recommendations, and history in one interface.",
        note: "Arabic and English",
        linkLabel: "Features",
        href: "#features",
        icon: "chart",
      },
    ],
  },
  testimonials: {
    title: "Illustrative workflow feedback",
    subtitle: "Common usage scenarios — not performance testimonials.",
    disclaimer: "Names and quotes are illustrative product scenarios, not guaranteed outcomes.",
    items: [
      {
        quote:
          "I finally see the chart and conversation together instead of juggling separate windows.",
        name: "Reviewer A",
        role: "Illustrative scenario — forex reviewer",
        initials: "A",
      },
      {
        quote:
          "I like that every recommendation passes named checks, and when a check refuses, it says why.",
        name: "Reviewer B",
        role: "Illustrative scenario — gold trader",
        initials: "B",
      },
      {
        quote:
          "WAIT as a clear outcome beats rushed BUY/SELL signals without context.",
        name: "Reviewer C",
        role: "Illustrative scenario — daily review",
        initials: "C",
      },
      {
        quote:
          "Switching between Arabic and English makes review easier for a mixed team.",
        name: "Reviewer D",
        role: "Illustrative scenario — small team",
        initials: "D",
      },
      {
        quote:
          "The recommendation card with entry and stop is clearer than a long chat paragraph.",
        name: "Reviewer E",
        role: "Illustrative scenario — scalping review",
        initials: "E",
      },
      {
        quote:
          "I use Lonora's recommendations as a disciplined second opinion — the final call is always mine.",
        name: "Reviewer F",
        role: "Illustrative scenario — risk management",
        initials: "F",
      },
    ],
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Four plans with real usage credit",
    subtitle:
      "Every plan includes a monthly usage credit consumed by what you actually run. These prices come from the same source the billing system reads.",
    perMonth: "/month",
    creditsPrefix: "Monthly usage credit",
    highlightBadge: "Most popular",
    modelsAll: "All AI models",
    modelsCount: "AI models",
    featureLabels: {
      telegramBot: "Telegram recommendations agent",
      trackedRecommendations: "Every recommendation tracked to its outcome",
      voice: "Voice agent",
      scalpEngine: "Automated scalp engine",
      prioritySupport: "Priority support",
    },
    cta: "Compare full plans",
    contactCta: "Contact via Telegram",
    ctaNote: "Full details and FAQ on the pricing page.",
  },
  how: {
    title: "How it works",
    subtitle: "Three simple steps from a question to a complete recommendation.",
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
        title: "Take the recommendation",
        body: "You get entry, stop, and targets, tracked automatically to the outcome — execution is your decision, outside the platform.",
      },
    ],
  },
  workspace: {
    title: "One workspace",
    subtitle: "Everything you need for daily review in one place.",
    points: [
      "Live chart with symbol and timeframe",
      "Conversation with the Lonora agent",
      "Recommendation card with entry, stop, and targets",
      "Conversation history, recommendations, and their outcomes",
    ],
  },
  trust: {
    title: "Trust and transparency",
    subtitle: "Practical safeguards for traders — without promising outcomes.",
    items: [
      "The platform never places trades — recommendations only, the decision is yours",
      "Live OANDA market data behind every recommendation",
      "Mandatory checks (news, liquidity, structure, evidence) may refuse a recommendation and name the reason",
      "Every recommendation is tracked to its final outcome as it happened",
      "Clear recommendation status and historical review",
    ],
    riskNote:
      "Risk per Trade controls position size only; it never forces the direction or the plan.",
  },
  integrations: {
    title: "Real integrations",
    subtitle: "What the platform actually supports today.",
    items: [
      { name: "OANDA", availability: "Market data source" },
      { name: "Telegram", availability: "Full recommendations agent" },
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
    subtitle: "Short answers about Lonora, recommendations, and supported languages.",
    contactLead: "Can't find your answer?",
    contactLink: "Contact us",
    items: [
      {
        q: "Does Lonora execute trades?",
        a: "No — never, neither automatically nor with approval. Lonora issues explained recommendations with their levels; execution is your decision on your own platform.",
      },
      {
        q: "Do I need a broker account or MetaTrader?",
        a: "No. No broker link is needed — you sign up and receive recommendations directly, with market data from OANDA.",
      },
      {
        q: "Can I use the chart without any external connection?",
        a: "Yes. The chart, the conversation, and the recommendations all work with your platform account alone.",
      },
      {
        q: "What does Risk per Trade control?",
        a: "Position size only, based on your equity and stop distance. It does not change the market decision.",
      },
      {
        q: "Does Lonora guarantee profit?",
        a: "No. Trading involves risk. Lonora is a review and decision workspace — not a guaranteed profit system.",
      },
      {
        q: "Are Arabic and English supported?",
        a: "Yes. You can switch between Arabic and English in the interface.",
      },
      {
        q: "How do I receive recommendations on Telegram?",
        a: "From platform settings, tap \"Link Telegram\" and open the link — the same agent answers there with the same analysis.",
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
    blurb: `${BRAND_NAME} — a workspace that combines the chart, the conversation, and gold recommendations tracked to their outcome.`,
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
  LANDING_ROUTES.console,
  LANDING_ROUTES.privacy,
  LANDING_ROUTES.terms,
  LANDING_ROUTES.agreement,
  LANDING_ROUTES.risk,
  LANDING_ROUTES.about,
  LANDING_ROUTES.contact,
  "#features",
  "#how",
  "#stats",
  "#trust",
  "#pricing",
  "#faq",
] as const;
