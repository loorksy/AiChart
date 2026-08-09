/**
 * Ownership on every by-id bot handler.
 *
 * We closed an authz hole of exactly this shape on the strategy-enable route
 * (`strategyEnableGuard.test.ts`), and a by-id handler that trusts the path
 * segment is the same bug wearing a different hat. Bots are a richer target
 * than analyses: a bot row carries a configuration, and its runs carry a
 * simulated P&L history someone might reasonably want to read or destroy.
 *
 * Source inspection rather than live requests, matching
 * `strategyEnableGuard.test.ts`'s reasoning: exercising these routes for real
 * needs a session cookie and the isolated quant-agent service. What is cheap
 * and reliable is asserting that the specific footguns cannot come back.
 *
 * Layer two is `botStore.ts` itself, which offers NO accessor without a
 * `userId` — so a handler that forgot the check would have nothing to call.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const BOT_API_DIR = join(REPO_ROOT, "src", "app", "api", "quant-agent", "bots");
const STORE = join(REPO_ROOT, "src", "lib", "quantAgent", "botStore.ts");

/** Comments stripped: these assertions are about code, not about prose. */
function codeOf(path: string): string {
  return readFileSync(path, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const ROUTES = routeFiles(BOT_API_DIR);

/** A route whose folder path contains `[id]` addresses one specific row. */
const BY_ID_ROUTES = ROUTES.filter((path) => path.replace(/\\/g, "/").includes("/[id]"));

describe("the bot API surface", () => {
  it("has the routes this guard is meant to cover", () => {
    assert.ok(ROUTES.length >= 4, `expected at least four bot routes, found ${ROUTES.length}`);
    assert.ok(BY_ID_ROUTES.length >= 2, "expected the by-id routes to exist");
  });

  for (const path of ROUTES) {
    const relative = path.slice(REPO_ROOT.length + 1);
    const source = codeOf(path);

    it(`${relative} resolves the caller before doing anything`, () => {
      assert.match(source, /resolveQuantAgentUserId\(req\)/);
    });

    it(`${relative} never calls the service client directly`, () => {
      // Routes go through `botStore`, which is where the ownership check
      // lives. A route that imported `@/lib/quantAgent/client` could pass any
      // `owner_user_id` it liked.
      assert.ok(
        !/from "@\/lib\/quantAgent\/client"[\s\S]*?(getQuantBot|listQuantBots|simulateQuantBot|deleteQuantBot)/.test(
          source,
        ),
        `${relative} bypasses botStore`,
      );
    });
  }

  for (const path of BY_ID_ROUTES) {
    const relative = path.slice(REPO_ROOT.length + 1);
    const source = codeOf(path);

    it(`${relative} resolves the bot through the user-scoped accessor`, () => {
      assert.match(
        source,
        /getBot\(\s*userId\s*,/,
        `${relative} must look the bot up with the caller's id`,
      );
    });

    it(`${relative} 404s an unowned id rather than 403ing it`, () => {
      assert.match(source, /new ApiError\(404, "Bot not found\."\)/);
      assert.ok(
        !/new ApiError\(403/.test(source),
        `${relative} must not distinguish "not yours" from "not there"`,
      );
    });

    it(`${relative} never passes the raw path segment to a mutation`, () => {
      // Every mutation takes `userId` first. This catches the shape where a
      // handler reads `params.id` and hands it straight to a write.
      const mutations = source.match(/\b(deleteBot|simulateBot)\(([^)]*)\)/g) ?? [];
      for (const call of mutations) {
        assert.match(call, /\(\s*userId\s*,/, `${relative}: ${call} is not user-scoped`);
      }
    });
  }
});

describe("botStore offers no unscoped accessor", () => {
  const source = codeOf(STORE);

  it("every exported function takes userId first", () => {
    const exported = [...source.matchAll(/export async function (\w+)\(([\s\S]*?)\)/g)];
    assert.ok(exported.length >= 6, "expected the bot store accessors");
    for (const [, name, params] of exported) {
      assert.match(
        params.trim(),
        /^userId: number/,
        `${name} must take userId as its first parameter`,
      );
    }
  });

  it("reads re-assert ownership on the decoded record", () => {
    assert.match(source, /record\.ownerUserId === userId/);
    assert.match(source, /bot\.ownerUserId === userId/);
    assert.match(source, /run\.ownerUserId === userId/);
  });

  it("simulate resolves ownership before sending any candle", () => {
    const body = source.slice(source.indexOf("export async function simulateBot"));
    const getBotAt = body.indexOf("getBot(userId");
    const simulateAt = body.indexOf("simulateQuantBot(");
    assert.ok(getBotAt >= 0 && simulateAt > getBotAt, "ownership must be checked first");
  });
});
