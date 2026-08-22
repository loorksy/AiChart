/**
 * A VALUE-import graph walker for structural guards.
 *
 * tsc and lint cannot catch "a client component's bundle reaches the DB
 * driver" or "the zero-spend path reaches the LLM client" — both compile
 * fine and fail only at build or in production. These guards walk the import
 * graph the BUNDLER sees: every import that survives type erasure, including
 * dynamic `import()` (code-split but still bundled).
 *
 * Erased and therefore ignored:
 *  - `import type { A } from "x"` and `export type { A } from "x"`;
 *  - named lists where EVERY specifier is `type X` (`import { type A } from "x"`);
 *  - type-position dynamic imports (`import("x").SomeType`) — a property
 *    access directly on the import expression is a type annotation, since at
 *    runtime that expression is a Promise and only .then/.catch/.finally
 *    would be meaningful (those ARE runtime and are followed).
 */
import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = path.join(process.cwd(), "src");

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".jsx"];

/** Resolve one specifier from `fromFile` to an absolute file inside src/, or null. */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = path.join(SRC_ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // bare specifier — a package, outside this graph
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every specifier in `source` that survives type erasure. */
export function valueImportSpecifiers(source: string): string[] {
  const out: string[] = [];

  // Static import/export ... from "spec". Skip `import type` / `export type`.
  const staticRe =
    /(?:^|\n)\s*(import|export)\s+([^;]*?)\sfrom\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(staticRe)) {
    const clause = match[2]!.trim();
    if (/^type\s/.test(clause)) continue; // import type {...} — erased whole
    // A named list where every specifier is `type X` is erased too.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const specifiers = named[1]!
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (specifiers.length > 0 && specifiers.every((item) => /^type\s/.test(item))) {
        continue;
      }
    }
    out.push(match[3]!);
  }

  // Side-effect imports: import "spec".
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    out.push(match[1]!);
  }

  // Dynamic import("spec"): runtime (bundled) unless used as a TYPE POSITION —
  // recognized as a property access directly on the import expression that is
  // not a Promise method. `await import(...)`, bare `import(...)`, and
  // `.then(...)` chains all execute and are followed.
  const dynamicRe = /import\s*\(\s*["']([^"']+)["']\s*\)(\s*\.\s*([A-Za-z_$][\w$]*))?/g;
  for (const match of source.matchAll(dynamicRe)) {
    const accessed = match[3];
    if (accessed && !["then", "catch", "finally"].includes(accessed)) {
      continue; // import("x").SomeType — a type annotation, erased
    }
    out.push(match[1]!);
  }

  // CommonJS require("spec") — rare here, but bundled when present.
  for (const match of source.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push(match[1]!);
  }

  return out;
}

export interface WalkResult {
  /** Every file reachable through value imports, including the roots. */
  reachable: Set<string>;
  /** file → the file that first imported it (for printing a chain). */
  cameFrom: Map<string, string>;
}

/** BFS the value-import graph from `roots` (absolute paths). */
export function walkValueImports(roots: string[]): WalkResult {
  const reachable = new Set<string>();
  const cameFrom = new Map<string, string>();
  const queue = [...roots];
  for (const root of roots) reachable.add(root);
  while (queue.length) {
    const file = queue.shift()!;
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of valueImportSpecifiers(source)) {
      const resolved = resolveSpecifier(file, spec);
      if (!resolved || reachable.has(resolved)) continue;
      reachable.add(resolved);
      cameFrom.set(resolved, file);
      queue.push(resolved);
    }
  }
  return { reachable, cameFrom };
}

/** The import chain root → … → file, repo-relative, for a readable failure. */
export function chainTo(result: WalkResult, file: string): string {
  const chain: string[] = [];
  let current: string | undefined = file;
  while (current) {
    chain.unshift(path.relative(process.cwd(), current));
    current = result.cameFrom.get(current);
  }
  return chain.join(" → ");
}

/** All files under `dir` (absolute) matching the extension filter. */
export function listSourceFiles(dir: string, exts = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        stack.push(full);
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

/** True when the file opts into the client bundle with a "use client" directive. */
export function isClientComponent(file: string): boolean {
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  // The directive must appear before any code; scanning the prologue region
  // (comments allowed) is enough and avoids matching the string mid-file.
  const head = source.slice(0, 600);
  return /(^|\n)\s*["']use client["']\s*;?/.test(head);
}
