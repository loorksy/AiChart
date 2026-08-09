/**
 * Guard test: the old scripted-bot status strings must never come back into
 * agent/UI SOURCE. Static thinking text was removed at the source (not merely
 * filtered) — this scan fails the build if anyone reintroduces it.
 *
 * Ticker text like "أفحص السوق" is allowed ONLY when generated dynamically by
 * the model per run; hardcoding it in source is banned.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

/** Directories whose source must stay free of scripted status strings. */
const SCAN_DIRS = [
  "src/lib/agent",
  "src/components/agent",
  "src/hooks",
  "src/app/api/agent",
];

/** Banned scripted phrases (Arabic + English). */
const BANNED = [
  "فهمت أن السؤال عام",
  "أجهز إجابة عامة",
  "أجهّز إجابة عامة",
  "سأجيب دون تشغيل أدوات التداول",
  "فهمت أن الطلب",
  "ماذا يفعل الوكيل الآن",
  "جاري التفكير",
  "I understood",
  "Crafting response",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("static scripted phrases are removed from source", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("scans a meaningful number of source files", () => {
    assert.ok(files.length > 10, `only found ${files.length} files`);
  });

  for (const phrase of BANNED) {
    it(`no source file contains "${phrase.slice(0, 30)}"`, () => {
      const offenders = files.filter((f) =>
        readFileSync(f, "utf8").includes(phrase),
      );
      assert.deepEqual(
        offenders.map((f) => f.replace(ROOT, "")),
        [],
        `banned phrase found in: ${offenders.join(", ")}`,
      );
    });
  }
});
