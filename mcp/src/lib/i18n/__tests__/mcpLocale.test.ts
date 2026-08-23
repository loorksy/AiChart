import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MCP_LOCALE,
  dirForMcpLocale,
  normalizeLocale,
  resolveMcpLocale,
} from "../mcpLocale.js";
import {
  MCP_AR,
  MCP_EN,
  mcpStatusLabel,
  mcpT,
} from "../mcpTranslations.js";

describe("mcpLocale", () => {
  it("normalizes Arabic variants to ar", () => {
    assert.equal(normalizeLocale("ar"), "ar");
    assert.equal(normalizeLocale("ar-SA"), "ar");
    assert.equal(normalizeLocale("ar-SY"), "ar");
    assert.equal(normalizeLocale("AR_EG"), "ar");
  });

  it("normalizes English variants to en", () => {
    assert.equal(normalizeLocale("en"), "en");
    assert.equal(normalizeLocale("en-US"), "en");
    assert.equal(normalizeLocale("en-GB"), "en");
  });

  it("returns null for unrecognized / empty input", () => {
    assert.equal(normalizeLocale(""), null);
    assert.equal(normalizeLocale("fr-FR"), null);
    assert.equal(normalizeLocale(null), null);
    assert.equal(normalizeLocale(42), null);
  });

  // English is the platform default on every surface now; the account's
  // saved language (supplied as `account`) is what makes MCP speak Arabic.
  it("defaults to English when nothing resolves", () => {
    assert.equal(DEFAULT_MCP_LOCALE, "en");
    assert.equal(resolveMcpLocale({}), "en");
    assert.equal(resolveMcpLocale({ host: "fr-FR" }), "en");
    assert.equal(
      resolveMcpLocale({ account: "ar" }),
      "ar",
      "the account's own language still wins over the default",
    );
  });

  it("applies precedence: explicit > account > request > host", () => {
    assert.equal(
      resolveMcpLocale({ explicit: "en", account: "ar", request: "ar", host: "ar" }),
      "en",
    );
    assert.equal(resolveMcpLocale({ account: "en", request: "ar", host: "ar" }), "en");
    assert.equal(resolveMcpLocale({ request: "en", host: "ar" }), "en");
    assert.equal(resolveMcpLocale({ host: "en-GB" }), "en");
  });

  it("maps direction", () => {
    assert.equal(dirForMcpLocale("ar"), "rtl");
    assert.equal(dirForMcpLocale("en"), "ltr");
  });
});

describe("mcpTranslations", () => {
  it("has ar/en key parity", () => {
    assert.deepEqual(Object.keys(MCP_AR).sort(), Object.keys(MCP_EN).sort());
  });

  it("localizes account labels", () => {
    assert.equal(mcpT("ar", "balance"), "الرصيد");
    assert.equal(mcpT("en", "balance"), "Balance");
    assert.equal(mcpT("ar", "freeMargin"), "الهامش المتاح");
    assert.equal(mcpT("en", "equity"), "Equity");
  });

  it("localizes analysis + recommendation labels", () => {
    assert.equal(mcpT("ar", "direction"), "الاتجاه");
    assert.equal(mcpT("en", "confidence"), "Confidence");
    assert.equal(mcpT("ar", "riskReward"), "نسبة العائد إلى المخاطرة");
    assert.equal(mcpT("ar", "stopLoss"), "وقف الخسارة");
  });

  it("localizes statuses and verdicts", () => {
    assert.equal(mcpT("ar", "buy"), "شراء");
    assert.equal(mcpT("en", "sell"), "Sell");
    assert.equal(mcpStatusLabel("ar", "triggered"), "تم الدخول");
    assert.equal(mcpStatusLabel("ar", "sl_hit"), "ضُرب وقف الخسارة");
    assert.equal(mcpStatusLabel("en", "tp1_hit"), "TP1 reached");
  });

  it("localizes the empty state honestly", () => {
    assert.equal(mcpT("ar", "noData"), "لا توجد بيانات متاحة");
    assert.equal(mcpT("en", "noData"), "No data available");
  });

  it("falls back to the key for a missing translation", () => {
    assert.equal(mcpT("ar", "does.not.exist"), "does.not.exist");
  });
});
