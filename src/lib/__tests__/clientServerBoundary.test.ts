/**
 * Client/server boundary guard.
 *
 * tsc and eslint both pass a "use client" component that value-imports a
 * server-only module — the failure only appears when `next build` tries to
 * put pg, better-sqlite3, ioredis, or node:async_hooks into the browser
 * bundle, which is exactly how the VPS deploy broke (NotificationPrefsCard →
 * resident/notifications → resident/host → db). This test walks the real
 * import graph of every client component at test time, so that class of
 * break fails in test:ci instead of at deploy.
 *
 * Method: find every file whose first lines carry the "use client"
 * directive, then BFS its VALUE imports (`import type` / `export type` are
 * erased by the compiler and cannot pull code into a bundle, so they are
 * skipped; dynamic `import(...)` is followed — code-splitting still
 * bundles it). A path from a client file into any server-only root fails
 * the test with the full chain, so the fix site is named, not hunted.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC = path.join(import.meta.dirname, "..", "..");

/** Server-only roots: a client import graph may never reach these. */
const SERVER_ONLY: { prefix: string; reason: string }[] = [
  { prefix: "lib/db/", reason: "database drivers (pg, better-sqlite3)" },
  { prefix: "lib/db.ts", reason: "database entry" },
  { prefix: "lib/resident/", reason: "resident host (redis, db, async_hooks)" },
  { prefix: "lib/llm.ts", reason: "provider keys and server LLM calls" },
  { prefix: "lib/queue.ts", reason: "BullMQ / redis" },
  { prefix: "lib/telegram.ts", reason: "grammY bot transport + platform token" },
  { prefix: "lib/store.ts", reason: "server store over the database" },
  { prefix: "worker.ts", reason: "the resident worker process" },
];

/** Pure modules that live under a server-only root but are browser-safe. */
const PURE_ALLOWLIST = new Set<string>(["lib/resident/notificationPrefs.ts"]);

function isServerOnly(rel: string): { reason: string } | null {
  if (PURE_ALLOWLIST.has(rel)) return null;
  for (const entry of SERVER_ONLY) {
    if (rel === entry.prefix || rel.startsWith(entry.prefix)) return entry;
  }
  return null;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
}

function isClientFile(text: string): boolean {
  // The directive must be at the top of the file (before any statement);
  // scanning the first few lines tolerates comments and a shebang.
  return /^\s*(?:\/\/.*\n|\/\*[\s\S]*?\*\/\s*|\s*\n)*["']use client["']/.test(
    text.slice(0, 600),
  );
}

/**
 * Extract VALUE import specifiers. Erased-at-compile-time forms are
 * skipped, because they cannot pull code into a bundle:
 *  - `import type` / `export type` statements;
 *  - `import { type A, type B }` where EVERY named specifier is
 *    type-prefixed;
 *  - type-position dynamic imports, e.g. `foo: import("@/lib/x").SomeType`
 *    — recognized as `import(...)` followed by a property access that is
 *    not a promise method and not awaited.
 * Everything else — `export ... from`, side-effect imports, and runtime
 * `await import("...")` — counts (code-splitting still bundles it).
 */
export function valueImportSpecifiers(text: string): string[] {
  const out: string[] = [];
  const stmt =
    /(?:^|\n)\s*(import|export)\s+([^;]*?)from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|(await\s*)?import\s*\(\s*["']([^"']+)["']\s*\)(\s*\.\s*(?:then|catch|finally)\b|\s*\.\s*\w+)?/g;
  for (const m of text.matchAll(stmt)) {
    const bare = m[4]; // side-effect import "x"
    const dynamic = m[6];
    if (bare) {
      out.push(bare);
      continue;
    }
    if (dynamic) {
      const awaited = Boolean(m[5]);
      const tail = m[7] ?? "";
      const promiseMethod = /^\s*\.\s*(?:then|catch|finally)\b/.test(tail);
      const propertyAccess = tail.startsWith("") && /^\s*\./.test(tail);
      // `import("x").Foo` with no await and no promise method is a TYPE
      // position (erased). Awaited, promise-chained, or bare = runtime.
      if (!awaited && !promiseMethod && propertyAccess) continue;
      out.push(dynamic);
      continue;
    }
    const clause = (m[2] ?? "").trim();
    const spec = m[3]!;
    if (/^type\s/.test(clause)) continue; // import type / export type — erased
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const specifiers = named[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (specifiers.length && specifiers.every((s) => /^type\s/.test(s))) {
        continue; // every named specifier is type-prefixed — erased
      }
    }
    out.push(spec);
  }
  return out;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // package or node builtin — out of scope for this walk
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("client components never reach server-only modules", () => {
  const files: string[] = [];
  walk(SRC, files);
  const clientFiles = files.filter((f) => isClientFile(readFileSync(f, "utf8")));

  it("found the client components (the scan itself works)", () => {
    assert.ok(clientFiles.length > 10, `only ${clientFiles.length} client files found`);
  });

  for (const clientFile of clientFiles) {
    const rel = path.relative(SRC, clientFile);
    it(`${rel} stays inside the client boundary`, () => {
      // BFS with the chain recorded so a violation names its whole path.
      const queue: { file: string; chain: string[] }[] = [
        { file: clientFile, chain: [rel] },
      ];
      const seen = new Set<string>([clientFile]);
      while (queue.length) {
        const { file, chain } = queue.shift()!;
        const text = readFileSync(file, "utf8");
        for (const spec of valueImportSpecifiers(text)) {
          const resolved = resolveSpecifier(file, spec);
          if (!resolved || seen.has(resolved)) continue;
          seen.add(resolved);
          const resolvedRel = path.relative(SRC, resolved);
          const hit = isServerOnly(resolvedRel);
          assert.equal(
            hit,
            null,
            `client bundle would pull in ${resolvedRel} (${hit?.reason}) via:\n  ${[...chain, resolvedRel].join("\n  → ")}\nMove shared types/constants into a pure module or fetch through an API route.`,
          );
          queue.push({ file: resolved, chain: [...chain, resolvedRel] });
        }
      }
    });
  }
});
