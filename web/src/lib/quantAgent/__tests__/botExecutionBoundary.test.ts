/**
 * THE EXECUTION BOUNDARY, web side — rewritten for the live-via-executeIntent
 * design.
 *
 * Invariants:
 *   1. No file under `lib/quantAgent/bots/` imports a venue/broker/RPC SDK.
 *   2. Every bot order path goes through `executeIntent` — no second path.
 *   3. A bot in `simulation` creates no intent.
 *   4. UI surfaces show the bot's real mode and the linked account type.
 *
 * Comments are stripped before every textual scan — a comment that names a
 * forbidden import must not fail the suite.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  QUANT_BOT_DEFAULT_EXECUTION_MODE,
  QUANT_BOT_EXECUTION_MODES,
  assertBotExecutionAllowed,
  botExecutionFlagEnabled,
  resolveQuantBroker,
  BotExecutionForbiddenError,
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

const liveBot = {
  id: "qbot_test",
  ownerUserId: 7,
  executionMode: "live" as const,
};

describe("assertBotExecutionAllowed answers only the bot-specific questions", () => {
  it("refuses when the deploy flag is off — soft, no throw", () => {
    delete process.env[FLAG];
    assert.equal(botExecutionFlagEnabled(), false);
    const gate = assertBotExecutionAllowed({ userId: 7, bot: liveBot });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.code, "bot_execution_disabled");
  });

  it("refuses a simulation bot even when the deploy flag is on", () => {
    process.env[FLAG] = "1";
    const gate = assertBotExecutionAllowed({
      userId: 7,
      bot: { ...liveBot, executionMode: "simulation" },
    });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.code, "bot_simulation_only");
  });

  it("allows a live bot when the deploy flag is on", () => {
    process.env[FLAG] = "true";
    const gate = assertBotExecutionAllowed({ userId: 7, bot: liveBot });
    assert.deepEqual(gate, { ok: true });
  });

  it("refuses an ownership mismatch", () => {
    process.env[FLAG] = "1";
    const gate = assertBotExecutionAllowed({ userId: 99, bot: liveBot });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.code, "bot_ownership_mismatch");
  });

  it("resolveQuantBroker never returns a venue broker", () => {
    assert.throws(() => resolveQuantBroker(), BotExecutionForbiddenError);
  });

  it("execution modes are simulation | live", () => {
    assert.deepEqual([...QUANT_BOT_EXECUTION_MODES], ["simulation", "live"]);
    assert.equal(QUANT_BOT_DEFAULT_EXECUTION_MODE, "simulation");
  });
});

describe("no venue path under lib/quantAgent/bots/", () => {
  const botLibDir = join(REPO_SRC, "lib", "quantAgent", "bots");
  const files = walk(botLibDir);

  it("has modules to scan", () => {
    assert.ok(files.length >= 3, "expected bot lib modules");
  });

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
    );
  });

  it("no bot lib file imports a venue SDK or RPC helper", () => {
    // Match imports/calls, not bare tokens like a broker enum value.
    const forbidden = [
      /from\s+["']@\/lib\/metaapi/,
      /from\s+["']@\/lib\/mt5/,
      /from\s+["']@\/lib\/mt5local/,
      /from\s+["'][^"']*metaapi/,
      /from\s+["']ccxt["']/,
      /import\s*\(\s*["'][^"']*metaapi/,
      /\bgetRpcConnection\s*\(/,
      /\bmt5Order\s*\(/,
      /\bplaceOrder\s*\(/,
    ];
    const offenders: string[] = [];
    for (const path of files) {
      const code = codeOf(path);
      for (const needle of forbidden) {
        if (needle.test(code)) {
          offenders.push(`${path.slice(REPO_SRC.length + 1)}: ${needle}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("liveExecution is the only bot order path and it calls executeIntent", () => {
    const livePath = join(botLibDir, "liveExecution.ts");
    const code = codeOf(livePath);
    assert.match(code, /from\s+"@\/lib\/execution"/);
    assert.match(code, /\bexecuteIntent\s*\(/);
    assert.match(code, /\bcreateIntent\s*\(/);
    assert.match(code, /authorization_source:\s*"standing_auto"/);
    assert.match(code, /notional:\s*0/);
    assert.match(code, /bot_id:/);
    assert.match(code, /explicitApproval:\s*false/);

    // No other bots/ module may call executeIntent or createIntent.
    for (const path of files) {
      if (path.endsWith("liveExecution.ts")) continue;
      const other = codeOf(path);
      assert.doesNotMatch(
        other,
        /\bexecuteIntent\s*\(/,
        `${path} must not call executeIntent`,
      );
      assert.doesNotMatch(
        other,
        /\bcreateIntent\s*\(/,
        `${path} must not call createIntent`,
      );
    }
  });
});

describe("simulation bots create no intent", () => {
  it("assertBotExecutionAllowed fails before createIntent for simulation", () => {
    process.env[FLAG] = "1";
    const gate = assertBotExecutionAllowed({
      userId: 7,
      bot: { ...liveBot, executionMode: "simulation" },
      context: "scan",
    });
    assert.equal(gate.ok, false);
    // liveExecution.ts returns early on !gate.ok without calling createIntent —
    // pinned by reading the early-return structure.
    const live = codeOf(join(REPO_SRC, "lib", "quantAgent", "bots", "liveExecution.ts"));
    assert.match(live, /if\s*\(\s*!gate\.ok\s*\)/);
    assert.match(live, /intentCreated:\s*false/);
  });
});

describe("bot UI shows real mode and account type", () => {
  const componentDir = join(REPO_SRC, "components", "quantAgent", "bots");
  const client = readFileSync(join(componentDir, "BotsClient.tsx"), "utf-8");

  it("renders BotStatusBanner and AccountTypeBadge", () => {
    assert.match(client, /<BotStatusBanner\b/);
    assert.match(client, /AccountTypeBadge/);
    assert.match(client, /BotModeBadge/);
  });

  it("offers a per-bot arming control", () => {
    assert.match(client, /execution-mode/);
    assert.match(client, /set_live|setBotMode/);
  });
});
