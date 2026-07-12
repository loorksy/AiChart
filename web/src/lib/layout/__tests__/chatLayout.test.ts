import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  CHAT_WIDTH_STORAGE_KEY,
  DEFAULT_CHAT_WIDTH,
  DEFAULT_MOBILE_PANE,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
  clampChatWidth,
  loadChatWidth,
  saveChatWidth,
} from "@/lib/layout/chatLayout";
import { dirForLocale } from "@/lib/i18n";

describe("chat layout width", () => {
  it("clamps below/above the allowed range", () => {
    assert.equal(clampChatWidth(100), MIN_CHAT_WIDTH);
    assert.equal(clampChatWidth(9999), MAX_CHAT_WIDTH);
    assert.equal(clampChatWidth(420), 420);
  });

  it("falls back to the default for non-finite input", () => {
    assert.equal(clampChatWidth(Number.NaN), DEFAULT_CHAT_WIDTH);
    assert.equal(clampChatWidth(Infinity), DEFAULT_CHAT_WIDTH);
  });

  it("mobile tab state defaults to the chart", () => {
    assert.equal(DEFAULT_MOBILE_PANE, "chart");
  });
});

describe("chat width persistence", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("defaults when nothing is stored, then persists and restores (clamped)", () => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };

    assert.equal(loadChatWidth(), DEFAULT_CHAT_WIDTH);
    saveChatWidth(500);
    assert.equal(store.get(CHAT_WIDTH_STORAGE_KEY), "500");
    assert.equal(loadChatWidth(), 500);
    // Out-of-range persisted value is clamped on load.
    saveChatWidth(9999);
    assert.equal(loadChatWidth(), MAX_CHAT_WIDTH);
  });
});

describe("locale decides layout direction", () => {
  it("Arabic is RTL, English is LTR", () => {
    assert.equal(dirForLocale("ar"), "rtl");
    assert.equal(dirForLocale("en"), "ltr");
  });
});
