/**
 * Every link and every fetch in the UI must point at something that exists.
 *
 * This guard exists because of what it found. The performance page shipped a
 * whole section whose four controls — close a trade, approve an intent, reject
 * one, refresh the list — posted to `/api/trades`, `/api/trades/:id/close` and
 * `/api/trades/intents`. All four routes had been deleted with the execution
 * layer. The section rendered, the buttons looked live, and every click
 * answered 404 in the operator's hands. Beside it, a nav pill linked to
 * `/journal`, a page that does not exist either.
 *
 * Nothing caught any of it: TypeScript does not type-check a URL string, the
 * build does not resolve one, and no test asserted that a component's target
 * was reachable. A deletion elsewhere silently broke a surface here, which is
 * exactly the failure mode a migration produces most.
 *
 * So the check is structural: read the component tree, collect every literal
 * internal href and every literal `/api/...` fetch, and require a route file
 * for each. Dynamic segments are matched by shape, since `/api/x/${id}` can
 * only ever be verified as "a route with one dynamic segment lives there".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.join(import.meta.dirname, "..", "..");
const APP = path.join(SRC, "app");

const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every route the app actually serves, as segment arrays.
 *
 * Route groups `(name)` and parallel/intercepting segments are skipped rather
 * than treated as path segments — they shape the file tree, not the URL.
 */
function routeSegments(kind: "page" | "route"): string[][] {
  const file = kind === "page" ? /^page\.(tsx|ts|jsx|js)$/ : /^route\.(ts|js)$/;
  const found: string[][] = [];
  const visit = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        const isGroup = entry.startsWith("(") && entry.endsWith(")");
        const isSlot = entry.startsWith("@");
        if (isSlot) continue;
        visit(full, isGroup ? segments : [...segments, entry]);
      } else if (file.test(entry)) {
        found.push(segments);
      }
    }
  };
  visit(APP, []);
  return found;
}

/** A path segment that matches anything — `[id]`, `[...slug]`, `[[...slug]]`. */
function isDynamic(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

function isCatchAll(segment: string): boolean {
  return segment.startsWith("[...") || segment.startsWith("[[...");
}

/** Does any known route match this requested path? */
function matches(routes: string[][], requested: string[]): boolean {
  return routes.some((route) => {
    for (let index = 0; index < route.length; index += 1) {
      const segment = route[index]!;
      if (isCatchAll(segment)) return true;
      if (index >= requested.length) return false;
      if (isDynamic(segment)) continue;
      if (segment !== requested[index]) return false;
    }
    return route.length === requested.length;
  });
}

/** A URL literal reduced to segments, with template holes as wildcards. */
function toSegments(url: string): string[] | null {
  const withoutQuery = url.split("?")[0]!.split("#")[0]!;
  if (!withoutQuery.startsWith("/")) return null;
  return withoutQuery
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.includes("*") ? "*" : segment));
}

/**
 * A requested path where `*` stands for an interpolated value.
 *
 * A hole matches any single segment, dynamic or literal. Requiring a DYNAMIC
 * segment reads stricter but is wrong: `/api/auth/${isLogin ? "login" :
 * "register"}` interpolates a choice between two LITERAL routes, and flagging
 * it would report a defect that is not there. Nothing real is lost — a call to
 * a prefix that does not exist at all still fails, which is every case this
 * guard was written for.
 */
function matchesWithHoles(routes: string[][], requested: string[]): boolean {
  return routes.some((route) => {
    for (let index = 0; index < route.length; index += 1) {
      const segment = route[index]!;
      if (isCatchAll(segment)) return true;
      if (index >= requested.length) return false;
      const want = requested[index]!;
      if (isDynamic(segment) || want === "*") continue;
      if (segment !== want) return false;
    }
    return route.length === requested.length;
  });
}

/**
 * Internal API URLs passed to `fetch`.
 *
 * Template literals are scanned by hand rather than by regex because a
 * `${...}` hole can itself contain quotes — `/api/auth/${isLogin ? "login" :
 * "register"}` ends a naive character-class match in the middle of the URL and
 * reports a route nobody wrote. Holes collapse to `*`, which the matcher then
 * requires a DYNAMIC route segment to satisfy.
 */
function internalFetchUrls(text: string): string[] {
  const urls: string[] = [];
  const opener = /fetch\(\s*(["'`])(\/api\/)/g;
  for (const match of text.matchAll(opener)) {
    const quote = match[1]!;
    let index = match.index! + match[0].length - match[2]!.length;
    let out = "";
    let depth = 0;
    for (; index < text.length; index += 1) {
      const char = text[index]!;
      if (depth === 0 && char === quote) break;
      if (quote === "`" && char === "$" && text[index + 1] === "{") {
        out += "*";
        depth = 1;
        index += 1;
        continue;
      }
      if (depth > 0) {
        if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        continue;
      }
      out += char;
    }
    if (out.startsWith("/api/")) urls.push(out);
  }
  return urls;
}

const componentFiles = [
  ...walk(path.join(SRC, "components")),
  ...walk(path.join(SRC, "app")),
  ...(existsSync(path.join(SRC, "hooks")) ? walk(path.join(SRC, "hooks")) : []),
];

test("every fetch to an internal API route has a route file", () => {
  const routes = routeSegments("route");
  const violations: string[] = [];
  for (const file of componentFiles) {
    // Route handlers themselves are the server side; they call outward.
    if (/[\\/]app[\\/]api[\\/]/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const url of internalFetchUrls(text)) {
      const segments = toSegments(url);
      if (!segments) continue;
      if (!matchesWithHoles(routes, segments)) {
        violations.push(`${path.relative(SRC, file)} → ${url}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `\nA control that calls a route which does not exist answers 404 in the operator's hands:\n${violations.join("\n")}\n`,
  );
});

/**
 * Every way a component can SEND the user somewhere, not only `href=`.
 *
 * The original guard read hrefs alone, and that gap is what it missed: five
 * navigations that do not render as links — `redirect("/awaiting-approval")`
 * in five layouts, `router.push("/console/account")` in the profile menu —
 * pointed at pages deleted by the migration. Every blocked user bounced into
 * a 404, and no test noticed, because a redirect is not an anchor tag.
 */
const NAVIGATION_PATTERNS = [
  /href=\{?["'`](\/[^"'`{}]*)["'`]/g,
  /\b(?:redirect|permanentRedirect)\(\s*["'`](\/[^"'`{}]*)["'`]/g,
  /\.(?:push|replace|prefetch)\(\s*["'`](\/[^"'`{}]*)["'`]/g,
];

/**
 * Destinations the app really serves that are NOT Next pages.
 *
 * `/admin-app/` is the admin console: a separate Flutter application, built
 * into `public/admin-app/` and reached through a rewrite. There is no
 * `page.tsx` for it and there never will be — but it is not a 404 either, so
 * neither "fail" nor "silently skip" is the right answer. It is allowed here
 * AND its existence is proved below, so this list cannot become a place to
 * hide a genuinely broken link.
 */
const NON_PAGE_DESTINATIONS = new Set(["/admin-app/", "/admin-app"]);

test("a non-page destination is actually served", () => {
  // The proof that earns `/admin-app/` its exemption above: something builds
  // the bundle, and something routes the URL to it.
  const REPO = path.join(SRC, "..");
  const config = readFileSync(path.join(REPO, "next.config.ts"), "utf8");
  assert.match(config, /source: "\/admin-app"/, "no rewrite serves /admin-app");
  assert.match(config, /destination: "\/admin-app\/index\.html"/);
  const build = readFileSync(path.join(REPO, "infra", "build-admin-app.sh"), "utf8");
  assert.match(build, /--base-href[= ]\/admin-app\//, "nothing builds the bundle");
});

test("every internal link, redirect, and push points at a page that exists", () => {
  const pages = routeSegments("page");
  const violations: string[] = [];
  for (const file of componentFiles) {
    const text = readFileSync(file, "utf8");
    for (const pattern of NAVIGATION_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const target = match[1]!;
        // API endpoints, files served from /public, and anchors are not pages.
        if (target.startsWith("/api/")) continue;
        if (/\.[a-z0-9]{2,5}$/i.test(target)) continue;
        // Served, but not by a page — see NON_PAGE_DESTINATIONS.
        if (NON_PAGE_DESTINATIONS.has(target)) continue;
        const segments = toSegments(target);
        if (!segments) continue;
        if (segments.length === 0) continue; // "/" is the root page
        if (!matches(pages, segments)) {
          violations.push(`${path.relative(SRC, file)} → ${target}`);
        }
      }
    }
  }
  assert.deepEqual(
    [...new Set(violations)],
    [],
    `\nA link to a page that does not exist is a 404 with a friendly label:\n${violations.join("\n")}\n`,
  );
});
