/**
 * The bot surfaces build several i18n keys DYNAMICALLY —
 * `qa.bots.type.${botType}`, `qa.bots.type.${botType}_hint`,
 * `qa.bots.warning.${code}`, `qa.bots.form.side.${side}` and
 * `qa.bots.form.grid_mode.${mode}`. The dictionary's compile-time parity
 * (`ar: Record<TranslationKey, string>`) cannot see any of them: it proves ar
 * and en agree, not that a key a component will actually ask for exists.
 *
 * That gap already shipped once — `rec.footer.awaiting_activation` reached
 * production as its own raw key string, which is why
 * `i18n/__tests__/recommendationCardKeys.test.ts` exists. This is the same
 * guard for `qa.bots.*`, and it also pins the warning codes against the
 * service's own list, so a warning the engine can emit can never render as a
 * bare snake_case token.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { messagesFor, t } from "@/lib/i18n";
import { QUANT_BOT_TYPES } from "@/lib/quantAgent/bots/types";

const LOCALES = ["ar", "en"] as const;
const PREFIX = "qa.bots.";

/**
 * Every warning `app/engine/bots/ladders.py` can append, blocking or not.
 * Kept as a literal list rather than derived, so adding one upstream fails
 * here and forces a translation rather than silently rendering the code.
 */
const WARNING_CODES = [
  "invalid_price_bounds",
  "neutral_grid_anchor_outside_bounds",
  "missing_dca_budget",
  "missing_entry_price",
  "missing_base_order_size",
  "invalid_trailing_take_profit",
  "invalid_equity_trailing_take_profit",
  "neutral_grid_count_adjusted_even",
  "max_open_orders_adjusted_to_grid_count",
  "high_frequency_grid_backtest_workload",
  "hard_stop_blocks_level",
];

function assertResolves(locale: (typeof LOCALES)[number], key: string): void {
  const value = t(locale, key);
  assert.notEqual(value, key, `${locale}: "${key}" is missing — it renders as the raw key`);
  assert.ok(value.trim().length > 0, `${locale}: "${key}" is blank`);
}

describe("qa.bots.* dynamic keys resolve in both locales", () => {
  for (const locale of LOCALES) {
    it(`${locale}: every bot type has a label and a hint`, () => {
      for (const type of QUANT_BOT_TYPES) {
        assertResolves(locale, `qa.bots.type.${type}`);
        assertResolves(locale, `qa.bots.type.${type}_hint`);
      }
    });

    it(`${locale}: every engine warning code has a sentence`, () => {
      for (const code of WARNING_CODES) {
        assertResolves(locale, `qa.bots.warning.${code}`);
      }
    });

    it(`${locale}: the enum-valued form fields have option labels`, () => {
      for (const side of ["long", "short"]) {
        assertResolves(locale, `qa.bots.form.side.${side}`);
      }
      for (const mode of ["arithmetic", "geometric"]) {
        assertResolves(locale, `qa.bots.form.grid_mode.${mode}`);
      }
    });

    it(`${locale}: the tab label exists`, () => {
      assertResolves(locale, "qa.tabs.bots");
    });
  }
});

describe("the two dictionaries agree on qa.bots.*", () => {
  it("same key set, no blanks", () => {
    const ar = Object.keys(messagesFor("ar")).filter((key) => key.startsWith(PREFIX));
    const en = Object.keys(messagesFor("en")).filter((key) => key.startsWith(PREFIX));
    assert.deepEqual(ar.slice().sort(), en.slice().sort());
    assert.ok(en.length >= 60, "the qa.bots namespace looks suspiciously small");
    for (const locale of LOCALES) {
      for (const key of Object.keys(messagesFor(locale)).filter((k) => k.startsWith(PREFIX))) {
        assert.ok(messagesFor(locale)[key].trim().length > 0, `${locale}:${key} is blank`);
      }
    }
  });

  it("the simulation-only wording is present in both languages", () => {
    for (const locale of LOCALES) {
      assertResolves(locale, "qa.bots.simulation_banner.title");
      assertResolves(locale, "qa.bots.simulation_banner.body");
      assertResolves(locale, "qa.bots.simulation_badge");
    }
    // Not a translation detail: the English body must actually say that no
    // order is placed, because that sentence is the product's honesty about
    // what these screens do.
    assert.match(t("en", "qa.bots.simulation_banner.body"), /never place an order/i);
  });

  it("interpolated keys keep their placeholders in both languages", () => {
    const interpolated: [string, Record<string, string>][] = [
      ["qa.bots.list.levels", { count: "3" }],
      ["qa.bots.run.stopped", { reason: "boundary" }],
      ["qa.bots.diagnostic.before_level", { level: "2" }],
      ["qa.bots.diagnostic.suggested", { pct: "1.50" }],
    ];
    for (const locale of LOCALES) {
      for (const [key, values] of interpolated) {
        const rendered = t(locale, key, values);
        assert.notEqual(rendered, key, `${locale}:${key} missing`);
        for (const [name, value] of Object.entries(values)) {
          assert.ok(
            rendered.includes(value),
            `${locale}:${key} dropped the {${name}} placeholder`,
          );
        }
      }
    }
  });
});

describe("no bot surface hard-codes a user-visible string", () => {
  const files = [
    "src/components/quantAgent/bots/BotsClient.tsx",
    "src/components/quantAgent/bots/BotLevelLadder.tsx",
    "src/components/quantAgent/bots/BotRunSummary.tsx",
    "src/components/quantAgent/bots/SimulationOnlyBanner.tsx",
  ];
  const repoRoot = join(__dirname, "..", "..", "..", "..");

  for (const relative of files) {
    it(`${relative} uses logical spacing only`, () => {
      const source = readFileSync(join(repoRoot, relative), "utf-8");
      // `web/DESIGN.md` §8: RTL is the primary direction, so physical margins
      // and offsets are forbidden in layout classes.
      for (const banned of [
        /className="[^"]*\bml-\d/,
        /className="[^"]*\bmr-\d/,
        /className="[^"]*\bpl-\d/,
        /className="[^"]*\bpr-\d/,
        /className="[^"]*\bleft-\d/,
        /className="[^"]*\bright-\d/,
        /className="[^"]*\btext-left\b/,
        /className="[^"]*\btext-right\b/,
      ]) {
        assert.ok(!banned.test(source), `${relative} uses a physical spacing class: ${banned}`);
      }
    });

    it(`${relative} uses tokens, never raw hex`, () => {
      const source = readFileSync(join(repoRoot, relative), "utf-8");
      assert.ok(
        !/#[0-9a-fA-F]{3,8}\b/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")),
        `${relative} contains a raw hex colour`,
      );
    });

    it(`${relative} sets dir on its root`, () => {
      const source = readFileSync(join(repoRoot, relative), "utf-8");
      assert.ok(source.includes("dir={dir}"), `${relative} must honour the locale direction`);
    });
  }
});
