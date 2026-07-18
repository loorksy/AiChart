import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AICHART_SCHEMA_VERSION } from "../schemaVersion";

const webRoot = path.resolve(__dirname, "../../../..");

function readRepoFile(...parts: string[]): string {
  return fs.readFileSync(path.join(webRoot, ...parts), "utf8");
}

test("canonical schema version is a non-empty dated migration id", () => {
  assert.match(
    AICHART_SCHEMA_VERSION,
    /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/,
    "AICHART_SCHEMA_VERSION must look like YYYY-MM-DD-name",
  );
});

test("runtime drivers and release validator share one schema-version source", () => {
  const pgSrc = readRepoFile("src/lib/db/pg.ts");
  const sqliteSrc = readRepoFile("src/lib/db/sqlite.ts");
  const validatorSrc = readRepoFile("scripts/validate-postgres-release.ts");
  const canonicalSrc = readRepoFile("src/lib/db/schemaVersion.ts");

  assert.match(
    canonicalSrc,
    /export const AICHART_SCHEMA_VERSION\s*=\s*"2026-07-18-nav-admin-subscription-v1"/,
  );

  for (const [label, src] of [
    ["pg.ts", pgSrc],
    ["sqlite.ts", sqliteSrc],
  ] as const) {
    assert.match(
      src,
      /from ["']\.\/schemaVersion["']/,
      `${label} must import ./schemaVersion`,
    );
    assert.match(
      src,
      /const SCHEMA_VERSION = AICHART_SCHEMA_VERSION/,
      `${label} must alias SCHEMA_VERSION from the canonical export`,
    );
    assert.doesNotMatch(
      src,
      /const SCHEMA_VERSION = ["']/,
      `${label} must not hardcode its own SCHEMA_VERSION string`,
    );
  }

  assert.match(
    validatorSrc,
    /from ["']\.\.\/src\/lib\/db\/schemaVersion["']/,
    "postgres release validator must import canonical schema version",
  );
  assert.match(
    validatorSrc,
    /AICHART_SCHEMA_VERSION/,
    "postgres release validator must assert against AICHART_SCHEMA_VERSION",
  );
  assert.doesNotMatch(
    validatorSrc,
    /assert\.equal\(\s*schemaVersion\?\.value,\s*["']/,
    "postgres release validator must not hardcode schema_version string literals",
  );
});

test("no second authoritative schema-version literal survives in db drivers", () => {
  const pgSrc = readRepoFile("src/lib/db/pg.ts");
  const sqliteSrc = readRepoFile("src/lib/db/sqlite.ts");
  // Allow the shared constant name, but forbid embedding the dated id again.
  const datedLiteral = /["']20\d{2}-\d{2}-\d{2}-[a-z0-9-]+["']/;
  assert.doesNotMatch(pgSrc, datedLiteral);
  assert.doesNotMatch(sqliteSrc, datedLiteral);
});
