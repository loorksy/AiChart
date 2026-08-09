/**
 * The analysis surfaces build several i18n keys DYNAMICALLY — one suffix per
 * decision (`qa.analysis.decision.${decision}`), per outlook label and
 * qualifier, per horizon, per status, per market, and per `dataQuality.missing`
 * code. The dictionary's own compile-time parity (`ar: Record<TranslationKey,
 * string>`) cannot see any of them: it proves ar and en agree, not that a key
 * a component will actually ask for exists at all.
 *
 * That gap already shipped once — `rec.footer.awaiting_activation` reached
 * production as its own raw key string, which is why
 * `i18n/__tests__/recommendationCardKeys.test.ts` exists. This is the same
 * guard for `qa.analysis.*`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messagesFor, t } from "@/lib/i18n";
import type { QuantAnalysisDecision, QuantAnalysisRecord } from "@/lib/quantAgent/types";

const LOCALES = ["ar", "en"] as const;
const PREFIX = "qa.analysis.";

type Horizon = NonNullable<QuantAnalysisRecord["horizon"]>;
type Status = QuantAnalysisRecord["status"];

/**
 * Compile-time exhaustive: widening the union without listing the member here
 * fails `tsc`, so the runtime loop can never silently skip a value.
 */
const DECISIONS = Object.keys({
  BUY: true,
  SELL: true,
  HOLD: true,
} satisfies Record<QuantAnalysisDecision, true>) as QuantAnalysisDecision[];

const HORIZONS = Object.keys({
  short: true,
  medium: true,
  long: true,
} satisfies Record<Horizon, true>) as Horizon[];

const STATUSES = Object.keys({
  completed: true,
  failed: true,
} satisfies Record<Status, true>) as Status[];

/**
 * `QuantAnalysisOutlookLeg.label` / `.qualifier` are typed `string` on the
 * frozen wire, so the compiler cannot close these two sets. They are closed in
 * fact, by quant-agent: `analysis/outlook.py`'s `OUTLOOK_LABELS`
 * (`BUY→bullish`, `SELL→bearish`, `HOLD→neutral`) and `_trend_strength`
 * (`>=70 strong`, `>=40 moderate`, `>=20 mild`, else `neutral`).
 */
const OUTLOOK_LABELS = ["bullish", "bearish", "neutral"];
const OUTLOOK_QUALIFIERS = ["strong", "moderate", "mild", "neutral"];

/** The four horizon legs the report renders, keyed as on the record. */
const OUTLOOK_LEGS = ["h24", "d3", "w1", "m1"];

/** The four score rows, keyed as on `QuantAnalysisRecord["scores"]`. */
const SCORE_KEYS = ["technical", "fundamental", "sentiment", "overall"];

/** The three prose blocks, keyed as on `QuantAnalysisRecord["detail"]`. */
const DETAIL_KEYS = ["technical", "fundamental", "sentiment"];

/**
 * Every code that can reach `dataQuality.missing`: web's own
 * `QUANT_ANALYSIS_UNAVAILABLE_COMPONENTS` (`lib/quantAgent/analysis/collect.ts`),
 * quant-agent's objective-component names (`analysis/consensus.py`), and the
 * per-indicator `degraded_inputs` the collector reports.
 */
const MISSING_CODES = [
  "fundamentals",
  "news_sentiment",
  "macro",
  "analysis_memory",
  "technical",
  "fundamental",
  "sentiment",
  "rsi",
  "macd",
  "moving_averages",
  "bollinger",
  "price_position",
  "volume_ratio",
  "atr",
  "change_24h",
];

/** The platform is forex-only (`lib/marketPolicy.ts`), so this is the whole set. */
const MARKETS = ["forex"];

function analysisKeys(locale: (typeof LOCALES)[number]): string[] {
  return Object.keys(messagesFor(locale)).filter((key) => key.startsWith(PREFIX));
}

describe("qa.analysis.* i18n parity", () => {
  it("ships the same qa.analysis.* key set in both locales", () => {
    const en = new Set(analysisKeys("en"));
    const ar = new Set(analysisKeys("ar"));
    assert.ok(en.size > 0, "no qa.analysis.* keys found in en");
    for (const key of en) assert.ok(ar.has(key), `ar is missing "${key}"`);
    for (const key of ar) assert.ok(en.has(key), `en is missing "${key}"`);
  });

  it("has a non-empty value for every qa.analysis.* key in both locales", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      for (const key of analysisKeys(locale)) {
        assert.ok(messages[key]?.trim().length, `${locale} has an empty value for "${key}"`);
      }
    }
  });

  it("resolves every dynamically built suffix in both locales", () => {
    const derived = [
      ...DECISIONS.map((decision) => `qa.analysis.decision.${decision}`),
      ...HORIZONS.map((horizon) => `qa.analysis.horizon.${horizon}`),
      ...STATUSES.map((status) => `qa.analysis.status.${status}`),
      ...OUTLOOK_LABELS.map((label) => `qa.analysis.outlook.label.${label}`),
      ...OUTLOOK_QUALIFIERS.map((qualifier) => `qa.analysis.outlook.qualifier.${qualifier}`),
      ...OUTLOOK_LEGS.map((leg) => `qa.analysis.outlook.${leg}`),
      ...SCORE_KEYS.map((score) => `qa.analysis.scores.${score}`),
      ...DETAIL_KEYS.map((detail) => `qa.analysis.detail.${detail}`),
      ...MISSING_CODES.map((code) => `qa.analysis.missing.${code}`),
      ...MARKETS.map((market) => `qa.analysis.market.${market}`),
    ];
    for (const locale of LOCALES) {
      for (const key of derived) {
        assert.notEqual(t(locale, key), key, `${locale} is missing "${key}"`);
      }
    }
  });

  it("keeps the {value} placeholder on the elapsed-time string in both locales", () => {
    for (const locale of LOCALES) {
      assert.ok(
        t(locale, "qa.analysis.elapsed").includes("{value}"),
        `${locale} lost the {value} placeholder on qa.analysis.elapsed`,
      );
      assert.equal(t(locale, "qa.analysis.elapsed", { value: "12s" }).includes("12s"), true);
    }
  });
});
