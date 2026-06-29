"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Locale = "ar" | "en";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, replacements?: Record<string, string>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const MESSAGES: Record<Locale, Record<string, string>> = {
  ar: {
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
    "welcome.subtitle": "اختر إعدادات الجلسة بالأسفل ثم اكتب رسالتك لتبدأ",
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
    "market.crypto": "كريبتو",
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
  },
  en: {
    // Navigation & Shell
    "sidebar.chat": "Chat",
    "sidebar.dashboard": "Dashboard",
    "sidebar.command": "Command",
    "sidebar.agent": "Agent",
    "sidebar.market": "Market",
    "sidebar.signals": "Signals",
    "sidebar.settings": "Settings",
    "sidebar.admin": "Admin Panel",
    "sidebar.new_chat": "New Chat",
    "sidebar.recent_chats": "Recent Chats",
    "sidebar.no_chats": "No chats yet",
    "sidebar.delete": "Delete",
    "sidebar.credits": "Balance",
    
    // Welcoming Phase
    "welcome.title": "Welcome, {name} 👋",
    "welcome.subtitle": "Configure your session settings below, then type your message to begin",
    "welcome.session_settings": "Session Settings",
    "welcome.response_mode": "Response Type",
    "welcome.trading_style": "Trading Style",
    "welcome.execution_mode": "Execution Mode",
    "welcome.market": "Market",
    
    // Terminology (Strict Transliterations/Originals)
    "term.scalping": "Scalping",
    "term.stop_loss": "Stop Loss",
    "term.take_profit": "Take Profit",
    "term.trailing": "Trailing",
    "term.spot": "Spot",
    "term.futures": "Futures",
    "term.day_trading": "Day Trading",
    "term.swing_trading": "Swing Trading",
    "term.margin": "Margin / Free Margin",
    "term.equity": "Equity",
    "settings.position": "Position",
    
    // Response Modes
    "response.fast": "Fast",
    "response.expert": "Expert",
    "response.vision": "Vision",
    
    // Execution Modes
    "mode.approval": "Approval",
    "mode.direct": "Direct",
    "mode.auto": "Auto",
    
    // Market types
    "market.crypto": "Crypto",
    "market.forex": "Forex",
    
    // Profile menu items
    "profile.settings": "Global Settings",
    "profile.analytics": "Analytics",
    "profile.account": "Account Parameters",
    "profile.theme": "Theme",
    "profile.theme.dark": "Dark",
    "profile.theme.light": "Light",
    "profile.language": "Language",
    "profile.language.ar": "العربية",
    "profile.language.en": "English",
    "profile.logout": "Sign Out",
    "profile.free_plan": "Free",

    // Placeholders
    "chat.placeholder": "Ask the expert about the market or your account…",
    "chat.placeholder_followup": "Follow up message…",
    "chat.placeholder_image": "Add a question about the chart (optional)…",
    "chat.no_agent_key": "AI agent not active — add OPENAI_API_KEY from Admin Panel.",
    "chat.chart_preview": "Chart Preview",
    "chat.close_chart": "Close Chart",
    "chat.resize_chart": "Resize Chart",
  }
};

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ar");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("aichart-locale") as Locale | null;
    const initial = stored === "ar" || stored === "en" ? stored : "ar";
    setLocaleState(initial);
    document.documentElement.dir = initial === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = initial;
    setMounted(true);
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    localStorage.setItem("aichart-locale", next);
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = next;
  };

  const t = (key: string, replacements?: Record<string, string>) => {
    let text = MESSAGES[locale]?.[key] ?? MESSAGES.ar[key] ?? key;
    if (replacements) {
      Object.entries(replacements).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
      });
    }
    return text;
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      <div className={!mounted ? "invisible" : ""}>
        {children}
      </div>
    </LocaleContext.Provider>
  );
}

const DEFAULT_LOCALE_CTX: LocaleContextValue = {
  locale: "ar",
  setLocale: () => {},
  t: (key: string) => MESSAGES.ar[key] ?? key,
};

export function useLocale() {
  const ctx = useContext(LocaleContext);
  // Return a safe default instead of throwing during SSR edge cases (Next.js 16 Turbopack)
  return ctx ?? DEFAULT_LOCALE_CTX;
}
