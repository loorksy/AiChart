/**
 * Nothing internal reaches the reader: no `undefined`, no raw enum member,
 * no start-screen prompt chips.
 *
 * Three live defects, one root: values that were never meant to be read were
 * pasted into the interface anyway.
 *
 *  - The account menu displayed "Trial: undefined of undefined recommendations
 *    remaining", and the top bar drew an empty "/" where the balance belongs.
 *    A client-side type still declared `trial_used`/`trial_limit`/
 *    `trial_remaining` long after the server stopped sending them, so
 *    TypeScript had no reason to object and `String(undefined)` did the rest.
 *  - The chat printed the literal token `descriptive_only` — an internal
 *    enum member, which is not a sentence and not in any language.
 *  - The start screen offered canned prompt chips that the operator asked to
 *    be gone.
 *
 * The type is honest again, which is what actually prevents the first class;
 * these are the guards that keep it that way.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { clearInterpolatedPlaceholders, interpolatedPlaceholders, t } from "@/lib/i18n";

const REPO = path.join(import.meta.dirname, "..", "..", "..");
const SRC = path.join(REPO, "src");

/**
 * Comments stripped before scanning. A guard that reads prose flags the very
 * comment explaining why the thing it forbids was removed — which is how this
 * file first failed against its own documentation.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(REPO, abs).split(path.sep).join("/");
    if (rel.includes("/__tests__/")) continue;
    out.push({ rel, text: stripComments(readFileSync(abs, "utf8")) });
  }
  return out;
}

describe("the interface never shows a value the user cannot read", () => {
  it("no client reads a trial counter — the server has none to send", () => {
    // The exact shape of the "undefined of undefined" defect: a field that
    // does not exist, read as though it did.
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      if (/\btrial_(used|limit|remaining)\b/.test(text)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `still reading deleted trial counters:\n${offenders.join("\n")}`);
  });

  it("the billing view is the SERVER's type, never a hand-copied twin", () => {
    // A duplicated type is a type that has stopped checking. This one drifted
    // for weeks and TypeScript stayed silent the whole time.
    const hook = stripComments(
      readFileSync(path.join(SRC, "hooks", "useBillingSummary.ts"), "utf8"),
    );
    assert.match(hook, /BillingSummaryView = AccountSummary/);
    assert.doesNotMatch(hook, /interface BillingSummaryView/);
  });

  it("interpolating a missing value is caught instead of shipped", () => {
    clearInterpolatedPlaceholders();
    // The exact call the account menu used to make.
    const rendered = t("en", "account.free_balance", { credits: String(undefined) });
    assert.doesNotMatch(rendered, /undefined/, "the word must never reach the reader");
    assert.ok(
      interpolatedPlaceholders().some((p) => p.includes("undefined")),
      "and the attempt is recorded, not silently swallowed",
    );
    clearInterpolatedPlaceholders();
    // A real value still renders normally.
    assert.match(t("en", "account.free_balance", { credits: "50" }), /50/);
    assert.deepEqual(interpolatedPlaceholders(), []);
  });

  it("the balance shows as a number for a Free account, same as for a subscriber", () => {
    // One currency, one number. The chip used to branch on the plan and draw
    // trial counters for a Free account.
    const chip = stripComments(
      readFileSync(path.join(SRC, "components", "shell", "BalanceChip.tsx"), "utf8"),
    );
    assert.match(chip, /\{summary\.balance\}/);
    assert.doesNotMatch(chip, /trial_remaining|trial_limit/);
  });

  it("no internal enum member is rendered raw", () => {
    // `descriptive_only` reached the screen this way. The values are named
    // here rather than pattern-matched so the check cannot quietly weaken.
    const raw = [
      "descriptive_only",
      "execution_validated",
      "operational_blocker",
    ];
    const offenders: string[] = [];
    for (const { rel, text } of sourceFiles()) {
      if (!rel.startsWith("src/components/")) continue;
      // Rendering the VALUE of the field, as opposed to comparing against it.
      if (/(?<!\$)\{\s*card\.envelope\.outcome_class\s*\}/.test(text)) {
        offenders.push(`${rel}: renders outcome_class directly`);
      }
      for (const value of raw) {
        // A bare quoted enum inside JSX text, e.g. <p>descriptive_only</p>.
        if (new RegExp(`>\\s*${value}\\s*<`).test(text)) {
          offenders.push(`${rel}: prints ${value}`);
        }
      }
    }
    assert.deepEqual(offenders, [], offenders.join("\n"));
  });

  it("every outcome class has a phrase in BOTH languages", () => {
    for (const outcome of ["execution_validated", "descriptive_only", "operational_blocker"]) {
      for (const locale of ["ar", "en"] as const) {
        const phrase = t(locale, `outcome.${outcome}`);
        assert.notEqual(phrase, `outcome.${outcome}`, `${locale} is missing ${outcome}`);
        assert.doesNotMatch(phrase, /_/, "a phrase, not a token");
      }
    }
  });

  it("the start screen offers no canned prompt chips", () => {
    // Deleted by request, not hidden behind a flag: the empty state is a
    // greeting and the composer.
    const panel = stripComments(
      readFileSync(path.join(SRC, "components", "agent", "SmartChartAgentPanel.tsx"), "utf8"),
    );
    assert.doesNotMatch(panel, /emptyState\.suggestions/);
    assert.doesNotMatch(panel, /LiquidMetalButton/);

    const state = stripComments(
      readFileSync(
        path.join(SRC, "lib", "agent", "suggestions", "generateEmptyChatState.ts"),
        "utf8",
      ),
    );
    assert.doesNotMatch(state, /suggestions:/, "the generator no longer produces them");
    assert.doesNotMatch(state, /suggestion chips/, "nor asks the model for them");
  });
});
