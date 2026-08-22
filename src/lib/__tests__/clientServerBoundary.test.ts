/**
 * Client/server boundary guard.
 *
 * The production build broke because a "use client" component imported
 * @/lib/resident/notifications for its TYPE VOCABULARY and got the resident
 * host — and through it the DB drivers, the queue, the Telegram adapter —
 * bundled for the browser. tsc and lint both pass on that mistake; only
 * `next build` fails, which is far too late to learn it.
 *
 * This guard walks the VALUE-import graph of every client component the way
 * the bundler does (type-only imports erased, dynamic imports followed) and
 * refuses any path into server-only territory. Shared vocabulary belongs in
 * pure modules (see resident/notificationPrefs.ts), never in the modules
 * that also deliver.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  chainTo,
  isClientComponent,
  listSourceFiles,
  valueImportSpecifiers,
  walkValueImports,
} from "./helpers/importGraph";

const ROOT = process.cwd();
const abs = (p: string) => path.join(ROOT, p);

/** Server-only territory: a client bundle reaching any of these is a build break. */
const SERVER_ONLY_PREFIXES = [
  "src/lib/db/",
  "src/lib/resident/",
  "src/lib/gold/candleStore",
  "src/lib/agent/orchestrator",
];
const SERVER_ONLY_FILES = [
  "src/lib/db.ts",
  "src/lib/llm.ts",
  "src/lib/queue.ts",
  "src/lib/telegram.ts",
  "src/lib/store.ts",
  "src/worker.ts",
  "src/lib/embeddings.ts",
];
/** Pure vocabulary modules a client component MAY share. */
const ALLOWLIST = new Set([abs("src/lib/resident/notificationPrefs.ts")]);

function isServerOnly(file: string): boolean {
  if (ALLOWLIST.has(file)) return false;
  const rel = path.relative(ROOT, file).replaceAll(path.sep, "/");
  return (
    SERVER_ONLY_PREFIXES.some((prefix) => rel.startsWith(prefix)) ||
    SERVER_ONLY_FILES.includes(rel)
  );
}

describe("client/server boundary", () => {
  it("no client component's bundle reaches a server-only module", () => {
    const clientRoots = listSourceFiles(abs("src"), [".tsx", ".ts"]).filter(
      isClientComponent,
    );
    assert.ok(
      clientRoots.length >= 30,
      `expected a real client-component population, found ${clientRoots.length} — the "use client" scan is broken`,
    );

    const offences: string[] = [];
    for (const root of clientRoots) {
      const walk = walkValueImports([root]);
      for (const file of walk.reachable) {
        if (isServerOnly(file)) {
          offences.push(chainTo(walk, file));
          break; // one chain per root is enough to read
        }
      }
    }
    assert.deepEqual(
      offences,
      [],
      `client bundles reach server-only modules:\n${offences.join("\n")}\n` +
        `Move the shared vocabulary into a pure module (like resident/notificationPrefs.ts) ` +
        `or fetch the data through an API route.`,
    );
  });

  it("the allowlisted vocabulary module stays pure (zero imports)", () => {
    const pure = abs("src/lib/resident/notificationPrefs.ts");
    const source = fs.readFileSync(pure, "utf8");
    assert.deepEqual(
      valueImportSpecifiers(source),
      [],
      "notificationPrefs.ts is allowlisted for client bundles BECAUSE it imports nothing — an import added here re-opens the hole",
    );
  });

  it("the walker still distinguishes erased imports from bundled ones", () => {
    // The false-positive and false-negative cases that actually occurred.
    assert.deepEqual(
      valueImportSpecifiers(`import type { A } from "@/lib/db";`),
      [],
      "import type is erased",
    );
    assert.deepEqual(
      valueImportSpecifiers(`import { type A, type B } from "@/lib/db";`),
      [],
      "an all-type named list is erased",
    );
    assert.deepEqual(
      valueImportSpecifiers(`type V = import("@/lib/store").AdminUserView;`),
      [],
      "a type-position dynamic import is erased",
    );
    assert.deepEqual(
      valueImportSpecifiers(`const { execute } = await import("@/lib/db");`),
      ["@/lib/db"],
      "await import() is bundled",
    );
    assert.deepEqual(
      valueImportSpecifiers(`import { t, type L } from "@/lib/i18n";`),
      ["@/lib/i18n"],
      "a mixed named list survives",
    );
  });
});
