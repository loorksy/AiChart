/**
 * Lightweight i18n helpers — expand to full next-intl when adding English UI.
 */

export type Locale = "ar" | "en";

const MESSAGES: Record<Locale, Record<string, string>> = {
  ar: {
    "chat.send": "إرسال",
    "chat.new": "محادثة جديدة",
    "chat.placeholder": "اكتب سؤالك…",
    "agent.name": "الخبير",
  },
  en: {
    "chat.send": "Send",
    "chat.new": "New chat",
    "chat.placeholder": "Ask anything…",
    "agent.name": "The Expert",
  },
};

export function t(key: string, locale: Locale = "ar"): string {
  return MESSAGES[locale][key] ?? MESSAGES.ar[key] ?? key;
}

export function detectLocale(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage) return "ar";
  return acceptLanguage.toLowerCase().includes("en") ? "en" : "ar";
}
