/**
 * Arabic belongs in the language map, not in system files — the ratchet.
 *
 * The owner's rule: no Arabic inside code. User-facing Arabic lives in
 * `src/lib/i18n/{ar,en}.ts` and reaches the code through `t()`, so every
 * string exists in both languages, drift is impossible, and a hardcoded
 * sentence can never quietly diverge from what the platform elsewhere says.
 *
 * The rule cannot be applied retroactively in one sweep — the repo carries
 * years of inline Arabic — so this test is a RATCHET, not a ban. The baseline
 * (`arabicBaseline.json`) records, per file, exactly how many lines contain
 * Arabic today. From here:
 *
 *  - a file NOT in the baseline may not contain Arabic at all;
 *  - a file IN the baseline may not grow its count;
 *  - when migration shrinks a file, the baseline must shrink WITH it (the
 *    test fails on an over-recorded entry too) — so the recorded debt is
 *    always the real debt and can only move toward zero.
 *
 * Exempt, by design, because they ARE the language layer:
 *  - `src/lib/i18n/**` — the language map itself;
 *  - `src/lib/telegram-ar-commands.json` — the Telegram menu vocabulary
 *    (language data, already a data file);
 *  - `src/components/landing/landingCopy.ts` — the landing page's structured
 *    bilingual copy map (a content dictionary, not logic);
 *  - test files — they pin Arabic BEHAVIOR and must quote it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC = path.join(import.meta.dirname, "..", "..");
const REPO = path.join(SRC, "..");

const ARABIC = /[؀-ۿ]/;

const EXEMPT_PREFIXES = ["src/lib/i18n/"];
const EXEMPT_FILES = new Set([
  "src/lib/telegram-ar-commands.json",
  "src/components/landing/landingCopy.ts",
]);

function isExempt(rel: string): boolean {
  if (EXEMPT_FILES.has(rel)) return true;
  if (EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) return true;
  if (rel.includes("/__tests__/")) return true;
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return true;
  return false;
}

function arabicLineCount(filePath: string): number {
  const text = readFileSync(filePath, "utf8");
  let count = 0;
  for (const line of text.split("\n")) if (ARABIC.test(line)) count += 1;
  return count;
}

function scan(): Map<string, number> {
  const found = new Map<string, number>();
  const entries = readdirSync(path.join(REPO, "src"), {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|json)$/.test(entry.name)) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(REPO, abs).split(path.sep).join("/");
    if (isExempt(rel)) continue;
    const count = arabicLineCount(abs);
    if (count > 0) found.set(rel, count);
  }
  return found;
}

const BASELINE: Record<string, number> = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "arabicBaseline.json"), "utf8"),
);

describe("Arabic stays out of system files (ratchet)", () => {
  const actual = scan();

  it("no NEW file contains Arabic — new strings go into src/lib/i18n via t()", () => {
    const intruders = [...actual.keys()].filter((rel) => !(rel in BASELINE));
    assert.deepEqual(
      intruders,
      [],
      `Arabic found in files outside the recorded debt. Move the strings into ` +
        `src/lib/i18n/{ar,en}.ts and read them with t(). Files:\n` +
        intruders.map((f) => `  ${f} (${actual.get(f)} lines)`).join("\n"),
    );
  });

  it("no recorded file grows its Arabic debt", () => {
    const grown = [...actual.entries()]
      .filter(([rel, count]) => rel in BASELINE && count > BASELINE[rel]!)
      .map(([rel, count]) => `  ${rel}: ${BASELINE[rel]} -> ${count}`);
    assert.deepEqual(
      grown,
      [],
      `Arabic-line counts increased. New user-facing strings belong in ` +
        `src/lib/i18n/{ar,en}.ts via t(); do not add Arabic to system files:\n` +
        grown.join("\n"),
    );
  });

  it("the baseline shrinks with the code — recorded debt is real debt", () => {
    // An entry larger than reality would let Arabic grow back unnoticed.
    // When a migration lowers a file's count (or clears it), lower or delete
    // its entry in arabicBaseline.json in the same change.
    const stale = Object.entries(BASELINE)
      .filter(([rel, recorded]) => (actual.get(rel) ?? 0) < recorded)
      .map(([rel, recorded]) => `  ${rel}: recorded ${recorded}, actual ${actual.get(rel) ?? 0}`);
    assert.deepEqual(
      stale,
      [],
      `Baseline entries exceed reality — tighten them in arabicBaseline.json:\n` +
        stale.join("\n"),
    );
  });

  it("the exempt list stays exact — no exempt path has quietly vanished", () => {
    for (const rel of EXEMPT_FILES) {
      assert.doesNotThrow(
        () => readFileSync(path.join(REPO, rel)),
        `${rel} is listed as exempt language data but does not exist`,
      );
    }
  });
});
