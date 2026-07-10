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
