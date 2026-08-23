/**
 * The admin console lives in ONE place: the Flutter app at /admin-app/.
 *
 * The in-app Next.js panel was deleted, not left as a second option, because
 * two admin surfaces meant two truths: prices edited in one, keys in the
 * other, and an operator who could not tell which screen was authoritative.
 * Every setting the platform has is now reachable from the Flutter app and
 * nowhere else.
 *
 * What THIS file checks, stated exactly — an earlier version of it claimed
 * more than it proved and that gap shipped a console missing three screens:
 *
 *  1. Every `/api/admin/*` route has a CLIENT METHOD in the Flutter
 *     repository. That is a wiring check on the API layer and nothing more.
 *     It does NOT show that any screen calls the method, and it does NOT
 *     show that an operator can navigate anywhere — every path lives in
 *     `repository.dart`, so deleting a whole screen leaves this green.
 *     Reachability is tested where it actually lives, against the rendered
 *     widget tree: `admin_flutter/test/routing_test.dart`.
 *  2. No admin UI grew back inside the web app. The old panel's components
 *     and its console page must stay gone.
 *  3. The bundle is built and served the way the deploy expects.
 *
 * The one deliberate exception is `mcp-auth/*`: those are callbacks the MCP
 * bridge posts to during a connector handshake, not screens.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO = path.join(import.meta.dirname, "..", "..", "..");
const ADMIN_API = path.join(REPO, "src", "app", "api", "admin");
const FLUTTER = path.join(REPO, "admin_flutter");

/** Machine-to-machine endpoints that are not operator screens. */
const NOT_A_SCREEN = new Set(["admin/mcp-auth/check-access", "admin/mcp-auth/verify"]);

/** Every admin route path, as it appears in a fetch URL. */
function adminRoutes(): string[] {
  const routes: string[] = [];
  const entries = readdirSync(ADMIN_API, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== "route.ts") continue;
    const rel = path
      .relative(path.join(REPO, "src", "app", "api"), path.join(entry.parentPath, entry.name))
      .split(path.sep)
      .join("/")
      .replace(/\/route\.ts$/, "");
    if (!NOT_A_SCREEN.has(rel)) routes.push(rel);
  }
  return routes.sort();
}

function flutterSource(): string {
  const dir = path.join(FLUTTER, "lib");
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".dart"))
    .map((e) => readFileSync(path.join(e.parentPath, e.name), "utf8"))
    .join("\n");
}

describe("the admin console is the Flutter app and only the Flutter app", () => {
  it("every /api/admin route has a client method (NOT a reachability check)", () => {
    // Deliberately narrow: an endpoint with no client method cannot be used
    // by the console at all. That it HAS one says nothing about whether a
    // screen calls it or an operator can navigate to that screen — see the
    // file comment, and routing_test.dart for the check that does.
    const dart = flutterSource();
    const uncalled: string[] = [];
    for (const route of adminRoutes()) {
      // A dynamic segment is an interpolation in Dart ('/api/admin/users/$id'),
      // so compare only the literal prefix before it.
      const literal = route.replace(/\/\[.*$/, "");
      if (!dart.includes(`/${literal}`)) uncalled.push(route);
    }
    assert.deepEqual(
      uncalled,
      [],
      `no Flutter client method for:\n${uncalled.join("\n")}`,
    );
  });

  it("reachability is tested against the widget tree, not by grepping files", () => {
    // The guard that keeps the correction above honest. If the routing test
    // is deleted or stops pumping the real shell, nothing else in this repo
    // would notice that screens had become unreachable.
    const routing = readFileSync(
      path.join(FLUTTER, "test", "routing_test.dart"),
      "utf8",
    );
    assert.match(routing, /pumpWidget/, "it must build the real shell");
    assert.match(routing, /NavigationRail/);
    assert.match(routing, /IndexedStack/);
    // The required destinations are named there, so adding a screen to the
    // console means declaring it in the test too.
    for (const screen of [
      "OverviewScreen",
      "UsersScreen",
      "BillingScreen",
      "PricingScreen",
      "AdsScreen",
      "ProvidersScreen",
      "ConfigScreen",
      "OperationsScreen",
      "SupportScreen",
      "AdminsScreen",
    ]) {
      assert.ok(routing.includes(screen), `${screen} is not in the routing test`);
    }
  });

  it("covers the settings the platform charges and answers on", () => {
    // Named explicitly rather than counted: these are the ones whose absence
    // would be felt, and a route rename that silently drops one should fail
    // here rather than be discovered in production.
    const dart = flutterSource();
    for (const surface of [
      "/api/admin/billing/config", // plan price, credit prices, welcome grant, R:R floor
      "/api/admin/billing/packs",
      "/api/admin/billing/offers",
      "/api/admin/billing/adjust", // manual per-user credit top-up
      "/api/admin/billing/reset-accounts",
      "/api/admin/config", // platform keys
      "/api/admin/config/providers", // AI_PROVIDER + per-provider status
      "/api/admin/config/models",
      "/api/admin/model-prices",
      "/api/admin/ads",
      "/api/admin/ads/upload",
      "/api/admin/usage",
      "/api/admin/diagnostics",
      "/api/admin/roles",
      "/api/admin/support",
    ]) {
      assert.ok(dart.includes(surface), `${surface} has no Flutter caller`);
    }
  });

  it("the old in-app admin panel is gone, not hidden", () => {
    assert.equal(
      existsSync(path.join(REPO, "src", "components", "admin")),
      false,
      "src/components/admin still exists — the old panel must be deleted, not disabled",
    );
    assert.equal(
      existsSync(path.join(REPO, "src", "components", "bridge", "sections", "PlatformSection.tsx")),
      false,
      "PlatformSection still exists — it mounted the old admin tabs",
    );
  });

  it("no web page renders admin panels any more", () => {
    const src = path.join(REPO, "src");
    const entries = readdirSync(src, { recursive: true, withFileTypes: true });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const rel = path
        .relative(REPO, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/");
      if (rel.includes("/__tests__/")) continue;
      const text = readFileSync(path.join(entry.parentPath, entry.name), "utf8");
      if (/@\/components\/admin\//.test(text)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `still importing the deleted panel:\n${offenders.join("\n")}`);
  });

  it("the admin app is served under /admin-app/", () => {
    // The base href is what makes the built bundle resolve its own assets
    // under that path; getting it wrong yields a white page with 404s.
    const build = readFileSync(path.join(REPO, "infra", "build-admin-app.sh"), "utf8");
    assert.match(build, /--base-href[= ]\/admin-app\//);

    // And the rewrite is what makes the URL an operator actually types
    // answer at all. `public/admin-app/` is a FOLDER, and a folder has no
    // index route: without this, /admin-app/ 308s to /admin-app and 404s,
    // while every asset under it serves fine — a console that is broken at
    // precisely one URL, the only one anybody uses. Verified by hand against
    // `next start` before it was written down.
    const config = readFileSync(path.join(REPO, "next.config.ts"), "utf8");
    assert.match(config, /source: "\/admin-app"/);
    assert.match(config, /destination: "\/admin-app\/index\.html"/);
  });

  it("the deploy rebuilds the console every time, or aborts", () => {
    // The failure this pins actually happened: the deploy kept an old bundle
    // when it could not rebuild, logged one quiet line about it, restarted
    // everything and exited 0. The console stayed three screens out of date
    // through a whole release with nothing reporting a problem.
    const deploy = readFileSync(path.join(REPO, "infra", "vps-pull-deploy.sh"), "utf8");
    assert.match(deploy, /build-admin-app\.sh/, "the deploy must build the console");
    assert.match(deploy, /DEPLOY ABORTED/, "and stop when it cannot");
    assert.match(deploy, /exit 1/);
    // No path may accept the bundle already on disk as good enough.
    assert.doesNotMatch(
      deploy,
      /elif\s*\[\[\s*-f\s*"\$INSTALL_DIR\/public\/admin-app/,
      "the keep-the-existing-bundle fallback must not come back",
    );
    // The same deploy must not resurrect the worker-through-npm shape that
    // orphaned the health port on every hard kill.
    assert.doesNotMatch(deploy, /^\s*pm2 start npm/m);
    assert.match(deploy, /pm2 start "\$ECOSYSTEM"/);
  });

  it("the bundle can never be served stale", () => {
    // Flutter's web output does not content-hash its filenames — every build
    // writes the same main.dart.js — so nothing here may be cached blindly,
    // and the service worker that served an old shell after a deploy is not
    // generated at all any more.
    const build = readFileSync(path.join(REPO, "infra", "build-admin-app.sh"), "utf8");
    assert.match(build, /--pwa-strategy=none/, "no service worker is shipped");
    assert.match(build, /rm -rf "\$APP\/build\/web"/, "stale artifacts are not republished");

    const config = readFileSync(path.join(REPO, "next.config.ts"), "utf8");
    assert.match(config, /"\/admin-app\/:path\*"/);
    assert.match(config, /no-store, must-revalidate/);
    // Verified live against `next start`: entry points answer no-store and
    // the rest no-cache. The rule order is what makes that true — the broad
    // rule first, the entry points last, because the last match wins.
    const broad = config.indexOf('"/admin-app/:path*"');
    const entryPoints = config.indexOf("/admin-app/:file(index");
    assert.ok(
      broad < entryPoints,
      "the catch-all must come first or it downgrades the entry points",
    );

    // A worker registered by an earlier build survives in the browser until
    // something removes it, so the page removes it.
    const index = readFileSync(path.join(REPO, "admin_flutter", "web", "index.html"), "utf8");
    assert.match(index, /getRegistrations/);
    assert.match(index, /unregister/);
    assert.match(index, /location\.reload/);
  });
});
