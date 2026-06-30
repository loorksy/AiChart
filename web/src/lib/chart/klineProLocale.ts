import { loadLocales } from "@klinecharts/pro";

let registered = false;

/** Pro en-US bundle omits symbol_search / symbol_code — register Arabic UI strings once. */
export function ensureKlineProLocale(): void {
  if (registered) return;
  registered = true;

  loadLocales("ar", {
    indicator: "مؤشر",
    main_indicator: "مؤشر رئيسي",
    sub_indicator: "مؤشر فرعي",
    setting: "إعدادات",
    timezone: "المنطقة الزمنية",
    screenshot: "لقطة شاشة",
    full_screen: "ملء الشاشة",
    exit_full_screen: "إنهاء ملء الشاشة",
    save: "حفظ",
    confirm: "تأكيد",
    cancel: "إلغاء",
    symbol_search: "بحث عن زوج",
    symbol_code: "رمز الزوج",
    period: "الإطار",
    restore_default: "استعادة الافتراضي",
  });
}

export const KLINE_PRO_LOCALE = "ar";
