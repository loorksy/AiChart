import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messagesFor } from "@/lib/i18n";

/**
 * The signal-history surface builds several i18n keys DYNAMICALLY — one per
 * decision (`qa.signals.decision.${decision}`), per channel, and per delivery
 * status. The dictionary's compile-time parity (`ar: Record<TranslationKey,
 * string>`) cannot see any of them: it proves ar and en agree, not that a key
 * a component will actually ask for exists at all.
 *
 * Same guard, same reason, as `analysisI18nParity.test.ts` — a key that only
 * exists at runtime reaches production as its own raw key string, which is how
 * `rec.footer.awaiting_activation` shipped.
 *
 * `@/lib/i18n` is imported statically because it is pure (`ar`, `en`, `types`
 * and nothing else). Every other import in this directory has to be dynamic
 * and after `DB_PATH` is set — see `monitorFireRule.test.ts`.
 */
const LOCALES = ["ar", "en"] as const;

/** Closed by `SignalDecision` in `signalEventStore.ts`. */
const DECISIONS = ["BUY", "SELL", "HOLD"];
/** Closed by `SIGNAL_CHANNELS`. Deliberately no `email`: there is no SMTP. */
const CHANNELS = ["telegram", "push", "webhook"];
/** Closed by `SignalDeliveryStatus`. */
const STATUSES = ["delivered", "failed", "skipped"];

const STATIC_KEYS = [
  "qa.tabs.signals",
  "qa.signals.title",
  "qa.signals.subtitle",
  "qa.signals.loading",
  "qa.signals.error",
  "qa.signals.retry",
  "qa.signals.load_more",
  "qa.signals.empty.title",
  "qa.signals.empty.description",
  "qa.signals.empty.cta",
  "qa.signals.filter.all",
  "qa.signals.filter.buy",
  "qa.signals.filter.sell",
  "qa.signals.filter.hold",
  "qa.signals.level.entry",
  "qa.signals.level.stop",
  "qa.signals.level.target",
  "qa.signals.confidence",
  "qa.signals.monitor",
  "qa.signals.monitor_removed",
  "qa.signals.rule",
  "qa.signals.rule.always",
  "qa.signals.rule.on_change",
  "qa.signals.rule.on_change_from",
  "qa.signals.delivery",
  "qa.signals.delivery.none",
  "qa.signals.rationale",
  "qa.monitors.field.fire_rule",
  "qa.monitors.fire_rule.always",
  "qa.monitors.fire_rule.on_change",
];

function everyKey(): string[] {
  return [
    ...STATIC_KEYS,
    ...DECISIONS.map((decision) => `qa.signals.decision.${decision}`),
    ...CHANNELS.map((channel) => `qa.signals.channel.${channel}`),
    ...STATUSES.map((status) => `qa.signals.status.${status}`),
  ];
}

describe("qa.signals.* i18n", () => {
  for (const locale of LOCALES) {
    it(`${locale}: every key the signal log asks for exists and is non-empty`, () => {
      const messages = messagesFor(locale);
      const missing = everyKey().filter((key) => !messages[key]?.trim());
      assert.deepEqual(missing, [], `missing ${locale} strings: ${missing.join(", ")}`);
    });
  }

  it("the interpolated keys still carry their placeholders in both locales", () => {
    // `t()` silently leaves an unknown placeholder in place, so a translation
    // that dropped `{id}` renders "Monitor #" with no number and no error.
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      assert.match(messages["qa.signals.monitor"]!, /\{id\}/, `${locale} lost {id}`);
      assert.match(
        messages["qa.signals.rule.on_change_from"]!,
        /\{previous\}/,
        `${locale} lost {previous}`,
      );
    }
  });

  it("ar and en differ — the Arabic strings are translated, not copied", () => {
    const ar = messagesFor("ar");
    const en = messagesFor("en");
    const identical = STATIC_KEYS.filter((key) => ar[key] === en[key]);
    // "Webhook" is a product name and stays Latin in both, like elsewhere in
    // this dictionary; anything else being identical means a missed translation.
    assert.deepEqual(identical, [], `untranslated ar strings: ${identical.join(", ")}`);
  });
});
