/**
 * THE EXECUTION BOUNDARY, web side.
 *
 * AiChart's Quant Agent bots are a simulation. The single most valuable thing
 * this test suite can do is fail the build the day that stops being true by
 * accident, so it checks the boundary three ways:
 *
 *   1. `assertBotExecutionAllowed()` throws — with the flag unset, and with it
 *      set to every truthy spelling. A flag that could enable execution would
 *      make "did we ship live trading?" a question about production env vars;
 *      an unconditional throw keeps it a question about the code.
 *   2. Nothing in `src/` implements the `QuantBrokerPort` interface, and no
 *      bot module imports a broker/exchange SDK.
 *   3. Every bot UI surface renders the simulation banner or badge.
 *
 * Its sibling on the service side is
 * `quant-agent/tests/test_no_execution.py`, which proves the same thing about
 * the engine: one port, one `SimulatedQuantBroker`, no network imports.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  BotExecutionForbiddenError,
  QUANT_BOT_EXECUTION_MODE,
  assertBotExecutionAllowed,
  botExecutionFlagEnabled,
  resolveQuantBroker,
} from "@/lib/quantAgent/bots/brokerPort";

const REPO_SRC = join(__dirname, "..", "..", "..");
const FLAG = "QUANT_AGENT_BOT_EXECUTION_ENABLED";
const originalFlag = process.env[FLAG];

after(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Comments stripped: this file is about CODE, not about prose describing it. */
function codeOf(path: string): string {
  return readFileSync(path, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("bot execution is refused unconditionally", () => {
  it("throws with the flag unset", () => {
    delete process.env[FLAG];
    assert.equal(botExecutionFlagEnabled(), false);
    assert.throws(() => assertBotExecutionAllowed(), BotExecutionForbiddenError);
  });

  it("throws with the flag set — every truthy spelling", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " true "]) {
      process.env[FLAG] = value;
      assert.equal(botExecutionFlagEnabled(), true, `flag should read as on for ${value}`);
      assert.throws(
        () => assertBotExecutionAllowed("test"),
        BotExecutionForbiddenError,
        `execution must be refused even with ${FLAG}=${value}`,
      );
    }
  });

  it("says WHY when someone has tried to turn it on", () => {
    process.env[FLAG] = "1";
    try {
      assertBotExecutionAllowed("simulate");
      assert.fail("expected a throw");
    } catch (error) {
      assert.ok(error instanceof BotExecutionForbiddenError);
      assert.match(error.message, new RegExp(FLAG));
      assert.match(error.message, /code change under review/);
      assert.equal(error.status, 403);
      assert.equal(error.code, "QUANT_BOT_EXECUTION_FORBIDDEN");
    }
  });

  it("resolveQuantBroker never returns a broker", () => {
    delete process.env[FLAG];
    assert.throws(() => resolveQuantBroker(), BotExecutionForbiddenError);
  });

  it("the only execution mode is simulation", () => {
    assert.equal(QUANT_BOT_EXECUTION_MODE, "simulation");
  });
});

describe("no broker is wired anywhere in src/", () => {
  const files = walk(REPO_SRC);

  it("nothing implements QuantBrokerPort", () => {
    const implementors = files.filter((path) => {
      const code = codeOf(path);
      return (
        /\bimplements\s+QuantBrokerPort\b/.test(code) ||
        /:\s*QuantBrokerPort\s*=/.test(code) ||
        /satisfies\s+QuantBrokerPort\b/.test(code)
      );
    });
    assert.deepEqual(
      implementors.map((path) => path.slice(REPO_SRC.length + 1)),
      [],
      "a QuantBrokerPort implementation appeared — this is the change to scrutinise",
    );
  });

  it("no bot module imports an exchange or broker SDK", () => {
    // MetaAPI is the platform's real broker bridge; the bot surface must never
    // reach it, directly or through the execution helpers Lonora uses.
    const forbidden = [
      "metaapi",
      "ccxt",
      "@/lib/metaapi",
      "@/lib/mt5",
      "@/lib/executionSafety",
      "executeTrade",
      "openTrade",
      "placeOrder",
    ];
    const botFiles = files.filter(
      (path) =>
        path.includes(join("lib", "quantAgent", "bots")) ||
        path.includes(join("components", "quantAgent", "bots")) ||
        path.includes(join("api", "quant-agent", "bots")),
    );
    assert.ok(botFiles.length >= 6, "the bot file scan found suspiciously little to scan");
    const offenders: string[] = [];
    for (const path of botFiles) {
      const code = codeOf(path);
      for (const needle of forbidden) {
        if (code.includes(needle)) offenders.push(`${path.slice(REPO_SRC.length + 1)}: ${needle}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("no bot API route offers a start/stop/deploy verb", () => {
    const routeDir = join(REPO_SRC, "app", "api", "quant-agent", "bots");
    const routes = walk(routeDir);
    assert.ok(routes.length >= 4);
    for (const path of routes) {
      const relative = path.slice(REPO_SRC.length + 1);
      assert.ok(
        !/\/(start|stop|deploy|execute|order)\//.test(relative.replace(/\\/g, "/")),
        `${relative} looks like an execution verb`,
      );
    }
  });
});

describe("every bot surface carries the simulation label", () => {
  const componentDir = join(REPO_SRC, "components", "quantAgent", "bots");
  const components = walk(componentDir).filter((path) => path.endsWith(".tsx"));

  it("has components to check", () => {
    assert.ok(components.length >= 4, "expected the bot component set");
  });

  for (const path of components) {
    const relative = path.slice(REPO_SRC.length + 1);
    it(`${relative} renders or defines the simulation banner`, () => {
      const source = readFileSync(path, "utf-8");
      assert.ok(
        source.includes("SimulationOnlyBanner") ||
          source.includes("SimulationOnlyBadge") ||
          source.includes("qa.bots.simulation_banner"),
        `${relative} must carry the simulation-only label`,
      );
    });
  }

  it("the page renders the full banner, not just a badge", () => {
    const client = readFileSync(join(componentDir, "BotsClient.tsx"), "utf-8");
    assert.match(client, /<SimulationOnlyBanner\s*\/>/);
  });
});
