/**
 * Every route has a skeleton, and every skeleton is fluid.
 *
 * A loading state is not a nice-to-have here: a trader opening the console on
 * a phone over a mobile network sees the skeleton for longer than they see the
 * spinner it replaced, and a route that ships without one shows a blank frame
 * instead. So the rule is enforced rather than remembered — a new route with
 * no `loading.tsx` fails this test.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const APP_DIR = resolve(process.cwd(), "src/app");

function routeSegments(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    // Route groups and private folders are not routes of their own.
    if (entry.startsWith("_") || entry === "api") continue;
    routeSegments(full, out);
  }
  if (readdirSync(dir).includes("page.tsx")) out.push(dir);
  return out;
}

test("every route ships a loading skeleton", () => {
  const missing = routeSegments(APP_DIR)
    .filter((dir) => !readdirSync(dir).includes("loading.tsx"))
    .map((dir) => relative(APP_DIR, dir) || "/");
  assert.deepEqual(
    missing,
    [],
    `these routes render a blank frame while they load: ${missing.join(", ")}`,
  );
});

test("route skeletons describe their page rather than a bare spinner", () => {
  const offenders: string[] = [];
  for (const dir of routeSegments(APP_DIR)) {
    const source = readFileSync(join(dir, "loading.tsx"), "utf8");
    // Every loading file must render a skeleton from the shared library —
    // a hand-rolled spinner or an empty fragment is the thing being replaced.
    if (!/Skeleton/.test(source)) offenders.push(relative(APP_DIR, dir) || "/");
    assert.doesNotMatch(
      source,
      /animate-spin/,
      `${relative(APP_DIR, dir)}: a spinner is not a skeleton`,
    );
  }
  assert.deepEqual(offenders, []);
});

test("the skeleton library stays fluid at any viewport", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/ui/skeletons/page-skeletons.tsx"),
    "utf8",
  );
  // Fixed pixel widths would make a skeleton lie about the layout it stands
  // in on some screen. Heights are fine — a row is a row at any width.
  assert.doesNotMatch(source, /\bw-\[\d+px\]/, "fixed pixel widths break at small viewports");
  // Column counts must be declared per breakpoint, not left to one grid.
  assert.match(source, /grid-cols-2 gap-2 lg:grid-cols-4/);
  assert.match(source, /sm:grid-cols-2/);
  // Physical margins would not mirror under dir="rtl".
  assert.doesNotMatch(source, /\b(ml|mr)-\d/);
});

test("motion is optional: the shimmer stops for reduced-motion users", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  assert.match(css, /@keyframes skeleton-shimmer/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  // Colours come from tokens, so the shimmer works in both themes.
  assert.match(css, /color-mix\(in srgb, var\(--foreground\)/);
});
