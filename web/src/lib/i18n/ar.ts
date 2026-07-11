import type { TranslationKey } from "./en";

/** Arabic messages. Must cover every key in `en` (enforced by the type). */
export const ar: Record<TranslationKey, string> = {
  // Navigation & Shell
  "sidebar.chat": "المحادثة",
  "sidebar.dashboard": "اللوحة",
  "sidebar.command": "القيادة",
  "sidebar.agent": "الوكيل",
  "sidebar.market": "السوق",
  "sidebar.signals": "الإشارات",
  "sidebar.settings": "الإعدادات",
  "sidebar.admin": "لوحة الأدمن",
  "sidebar.new_chat": "محادثة جديدة",
  "sidebar.recent_chats": "المحادثات الأخيرة",
  "sidebar.no_chats": "لا محادثات بعد",
  "sidebar.delete": "حذف",
  "sidebar.credits": "الرصيد",

  // Welcoming Phase
  "welcome.title": "مرحباً {name} 👋",
  "welcome.subtitle": "اكتب رسالتك لتبدأ — فوركس عبر MetaTrader.",
  "welcome.session_settings": "إعدادات الجلسة",
  "welcome.response_mode": "نوع الرد",
  "welcome.trading_style": "أسلوب التداول",
  "welcome.execution_mode": "صلاحية التنفيذ",
  "welcome.market": "السوق",

  // Terminology (Strict Transliterations)
  "term.scalping": "سكالبينج",
  "term.stop_loss": "ستوب لوز",
  "term.take_profit": "تيك بروفيت",
  "term.trailing": "تريلينج",
  "term.spot": "سبوت",
  "term.futures": "فيوتشرز",
  "term.day_trading": "تداول يومي",
  "term.swing_trading": "سوينج",
  "term.margin": "مارجن / فري مارجن",
  "term.equity": "إيكويتي",
  "settings.position": "بوزيشن",

  // Response Modes
  "response.fast": "سريع",
  "response.expert": "خبير",
  "response.vision": "رؤية",

  // Execution Modes
  "mode.approval": "موافقة",
  "mode.direct": "مباشر",
  "mode.auto": "تلقائي",

  // Market types
  "market.forex": "فوركس",

  // Profile menu items
  "profile.settings": "الإعدادات العامة",
  "profile.analytics": "التحليلات",
  "profile.account": "معلمات الحساب",
  "profile.theme": "المظهر",
  "profile.theme.dark": "داكن",
  "profile.theme.light": "مضيء",
  "profile.language": "اللغة",
  "profile.language.ar": "العربية",
  "profile.language.en": "English",
  "profile.logout": "تسجيل الخروج",
  "profile.free_plan": "مجاني",

  // Placeholders
  "chat.placeholder": "اسأل الخبير عن السوق أو حسابك…",
  "chat.placeholder_followup": "تابع المحادثة…",
  "chat.placeholder_image": "أضف سؤالاً عن الشارت (اختياري)…",
  "chat.no_agent_key": "الذكاء الاصطناعي غير مُفعّل — أضِف OPENAI_API_KEY من لوحة الإدارة.",
  "chat.chart_preview": "معاينة الشارت",
  "chat.close_chart": "إغلاق الشارت",
  "chat.resize_chart": "تغيير حجم الشارت",

  // --- Part 5 additions: agent sidebar + chat shell ---
  "nav.new_chat": "محادثة جديدة",
  "nav.no_chats": "لا توجد محادثات بعد",
  "nav.chats": "المحادثات",
  "nav.statistics": "الإحصائيات",
  "nav.recommendations": "التوصيات",
  "nav.settings": "الإعدادات",
  "nav.integrations": "التكاملات",

  "profile.profile": "الملف الشخصي",
  "profile.trading_settings": "إعدادات التداول",
  "profile.account_menu": "الحساب",
  "profile.coming_soon": "قريباً",
  "profile.select_language": "اللغة",

  "agent.title": "الوكيل الذكي للشارت",
  "agent.empty": "اسأل الوكيل أو ابدأ تحليل الشارت",
  "agent.analyze_chart": "تحليل الشارت",
  "agent.news_risk": "خطر الأخبار",
  "agent.send": "إرسال",
  "agent.stop": "إيقاف",
  "agent.cancel": "إلغاء",
  "agent.close": "إغلاق",
  "agent.input_placeholder": "اسأل الوكيل عن هذا الشارت…",
  "agent.confidence": "ثقة",
  "agent.decision_reason": "سبب القرار:",
  "agent.needs_confirmation": "تحتاج الصفقة تأكيدك قبل التنفيذ",
  "agent.account_live": "حساب LIVE",
  "agent.account_demo": "محاكاة/ديمو",
  "agent.processing": "جاري المعالجة",
  "agent.run_details": "تفاصيل التنفيذ",
  "agent.error": "حدث خطأ",

  "decision.buy": "شراء",
  "decision.sell": "بيع",
  "decision.wait": "انتظار",
  "decision.informational": "معلومة",
  "decision.action_required": "يتطلب إجراء",

  "language.arabic": "العربية",
  "language.english": "English",
};
