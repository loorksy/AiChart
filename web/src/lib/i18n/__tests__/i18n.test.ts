import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  detectLocale,
  dirForLocale,
  getLocale,
  isAppLocale,
  setLocale,
  t,
  toggleLocale,
} from "@/lib/i18n";
import { contextualOptionsFor } from "@/lib/agent/contextualOptions";

describe("i18n core", () => {
  it("dirForLocale maps ar→rtl and en→ltr", () => {
    assert.equal(dirForLocale("ar"), "rtl");
    assert.equal(dirForLocale("en"), "ltr");
  });

  it("translates a key in each locale", () => {
    assert.equal(t("ar", "nav.new_chat"), "محادثة جديدة");
    assert.equal(t("en", "nav.new_chat"), "New Chat");
    assert.equal(t("ar", "agent.send"), "إرسال");
    assert.equal(t("en", "agent.send"), "Send");
  });

  it("has the Parts 7-9 labels in both dictionaries", () => {
    assert.equal(t("ar", "agent.run_details"), "تفاصيل التنفيذ");
    assert.equal(t("en", "agent.run_details"), "Run details");
    assert.equal(t("ar", "agent.processing"), "جاري المعالجة");
    assert.equal(t("en", "agent.processing"), "Processing");
    assert.equal(t("ar", "agent.error"), "حدث خطأ");
    assert.equal(t("en", "agent.error"), "Something went wrong");
  });

  it("has the Parts 10-13/19 layout labels in both dictionaries", () => {
    assert.equal(t("ar", "layout.chart"), "الشارت");
    assert.equal(t("en", "layout.chart"), "Chart");
    assert.equal(t("ar", "layout.chat"), "الشات");
    assert.equal(t("en", "layout.chat"), "Chat");
    assert.equal(t("ar", "layout.mt_connected"), "MT متصل");
    assert.equal(t("en", "layout.mt_disconnected"), "MT disconnected");
    assert.equal(t("ar", "layout.resize_chat"), "تغيير حجم الشات");
    assert.equal(t("ar", "trades.title"), "الصفقات");
    assert.equal(t("en", "trades.title"), "Trades");
    assert.equal(t("ar", "connect.mcp.title"), "Claude MCP");
    assert.equal(t("en", "connect.mcp.title"), "Claude MCP");
  });

  it("has the Parts 16-18 tracker + stats labels in both dictionaries", () => {
    assert.equal(t("ar", "stats.win_rate"), "نسبة النجاح");
    assert.equal(t("en", "stats.win_rate"), "Win rate");
    assert.equal(t("ar", "rec.step.entered"), "الدخول");
    assert.equal(t("en", "rec.entry.market"), "Market Entry");
    assert.equal(t("ar", "rec.tip.tp1"), "بعد وصول TP1، حرّك وقف الخسارة إلى نقطة الدخول لحماية الصفقة.");
    assert.equal(t("en", "stats.filter.7d"), "7 days");
  });

  it("ar and en dictionaries have identical key sets (parity)", async () => {
    const { ar } = await import("@/lib/i18n/ar");
    const { en } = await import("@/lib/i18n/en");
    const arKeys = Object.keys(ar).sort();
    const enKeys = Object.keys(en).sort();
    assert.deepEqual(arKeys, enKeys);
  });

  it("falls back safely for a missing key (returns the key)", () => {
    assert.equal(t("ar", "this.key.does.not.exist"), "this.key.does.not.exist");
    assert.equal(t("en", "this.key.does.not.exist"), "this.key.does.not.exist");
  });

  it("interpolates {name}", () => {
    assert.equal(t("en", "welcome.title", { name: "Sam" }), "Welcome, Sam 👋");
  });

  it("default locale is Arabic and toggle flips the locale", () => {
    assert.equal(DEFAULT_LOCALE, "ar");
    assert.equal(toggleLocale("ar"), "en");
    assert.equal(toggleLocale("en"), "ar");
  });

  it("isAppLocale + detectLocale", () => {
    assert.equal(isAppLocale("ar"), true);
    assert.equal(isAppLocale("en"), true);
    assert.equal(isAppLocale("de"), false);
    assert.equal(isAppLocale(null), false);
    assert.equal(detectLocale("en-US,en;q=0.9"), "en");
    assert.equal(detectLocale("ar-SA"), "ar");
    assert.equal(detectLocale(null), "ar");
  });
});

describe("locale persistence", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it("defaults to Arabic, then saves and restores the choice", () => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
    (globalThis as { document?: unknown }).document = { documentElement: {} };

    assert.equal(getLocale(), DEFAULT_LOCALE); // nothing stored → Arabic
    setLocale("en");
    assert.equal(store.get(LOCALE_STORAGE_KEY), "en");
    assert.equal(getLocale(), "en");
    setLocale("ar");
    assert.equal(getLocale(), "ar");
  });
});

describe("contextual options localization", () => {
  it("returns Arabic labels for ar and English labels for en", () => {
    const ar = contextualOptionsFor({ decision: "buy", locale: "ar" });
    const en = contextualOptionsFor({ decision: "buy", locale: "en" });
    assert.ok(ar && en);
    assert.equal(ar![0]!.label, "تابع حالة هذه التوصية");
    assert.equal(en![0]!.label, "Track this recommendation");
    // Same option ids across locales so number-replies resolve consistently.
    assert.deepEqual(
      ar!.map((o) => o.id),
      en!.map((o) => o.id),
    );
  });

  it("defaults to Arabic when no locale is given", () => {
    const opts = contextualOptionsFor({ decision: "informational", noActiveRecommendation: true });
    assert.equal(opts![0]!.label, "تحليل الشارت الحالي");
  });
});
