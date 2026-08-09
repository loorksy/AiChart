import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { PLATFORM_CONFIG_FIELDS } from "../platformConfig";

/**
 * A key the code reads from platform config but that PLATFORM_CONFIG_FIELDS
 * never declares is unsettable, silently: the admin panel renders no input for
 * it, and savePlatformConfig iterates the field list, so a hand-crafted POST is
 * dropped without an error. The only remaining way in is an env var on the box.
 *
 * That is how METAAPI_TOKEN (and, in its day, the OANDA keys) ended up unreachable while
 * separate surfaces told the operator to "add it from the platform panel". This
 * test walks the real source tree so the next key added to a getPlatformValue
 * call has to come with a field.
 */

const SRC = path.join(import.meta.dirname, "..", "..");
const READ_CALL = /getPlatformValue(?:Async)?\(\s*"([A-Z0-9_]+)"/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test("every platform-config key the code reads has a field in the panel", () => {
  const declared = new Set(PLATFORM_CONFIG_FIELDS.map((f) => f.key));
  const missing = new Map<string, string>();

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const [, key] of text.matchAll(READ_CALL)) {
      if (!declared.has(key!) && !missing.has(key!)) {
        missing.set(key!, path.relative(SRC, file).replace(/\\/g, "/"));
      }
    }
  }

  assert.deepEqual(
    [...missing].map(([key, file]) => `${key} (read in ${file})`),
    [],
    "these keys are read from platform config but have no field, so the panel cannot set them",
  );
});

test("the keys the operator was told to add are settable", () => {
  // The exact keys whose absence stranded the operator, pinned by name so a
  // refactor that drops one fails here rather than in production.
  for (const key of ["METAAPI_TOKEN"]) {
    const field = PLATFORM_CONFIG_FIELDS.find((f) => f.key === key);
    assert.ok(field, `${key} must be settable from the platform panel`);
  }
});

test("credentials are stored encrypted, plain values are not", () => {
  const encrypted = (key: string) => {
    const f = PLATFORM_CONFIG_FIELDS.find((x) => x.key === key)!;
    // savePlatformConfig: encrypt = secret && !plainStorage
    return f.secret && !f.plainStorage;
  };
  for (const key of ["METAAPI_TOKEN"]) {
    assert.equal(encrypted(key), true, `${key} must be encrypted at rest`);
  }
  // Non-secrets stay readable so the migration that marks them plain=1 agrees.
  for (const key of ["METAAPI_REGION"]) {
    assert.equal(encrypted(key), false, `${key} is not a secret`);
  }
});

test("every field belongs to a group the panel renders", () => {
  // AdminKeysPanel maps over a fixed GROUPS list; a field in an unlisted group
  // is invisible — the same failure as not declaring it at all.
  const rendered = new Set(["core", "ai", "markets", "telegram", "ops"]);
  for (const field of PLATFORM_CONFIG_FIELDS) {
    assert.ok(
      rendered.has(field.group),
      `${field.key} is in group "${field.group}", which the panel does not render`,
    );
  }
});
