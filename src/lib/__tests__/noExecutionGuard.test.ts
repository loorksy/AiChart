/**
 * The platform cannot place an order.
 *
 * That is a product property, not a coincidence of which files happen to exist
 * today, and it is exactly the kind of property that erodes: a helper comes
 * back for "just a preview", a widget gets a button, a catalogue entry is
 * restored because something imported its type. Every one of those was found
 * DURING this migration rather than prevented by it.
 *
 * So the guard is structural and reads the real tree. It does not grep for the
 * word "execution" — comments describing history are not a defect, and a check
 * that flagged them would be silenced within a week. It asserts the things that
 * would have to be true for an order to reach a broker:
 *
 *   1. no HTTP client posts to a broker order API,
 *   2. no MCP tool that places or modifies an order is registered or catalogued,
 *   3. no route exists to accept an execution request,
 *   4. the decision contract cannot express one.
 *
 * A failure here is not style. It means a code path can move money.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.join(import.meta.dirname, "..", "..");
const REPO = path.join(SRC, "..");
const SKIP = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source files, excluding the tests that must quote these names to ban them. */
const sourceFiles = [
  ...walk(path.join(SRC)),
  ...walk(path.join(REPO, "mcp", "src")),
].filter((file) => !/__tests__/.test(file));

function rel(file: string): string {
  return path.relative(REPO, file);
}

/**
 * Calls to a broker's order endpoints.
 *
 * Matched on the URL PATH rather than a function name, because the name is the
 * part a refactor changes and the path is the part the broker owns. MetaApi's
 * trade API is `/users/current/accounts/:id/trade`; MT5 bridges expose
 * `/order`, `/position/close` and friends.
 */
test("nothing in the codebase posts to a broker order endpoint", () => {
  const brokerPaths =
    /["'`][^"'`]*\/(?:accounts\/[^"'`]*\/trade|trade\/execute|order\/send|positions?\/close|orders?\/place)[^"'`]*["'`]/;
  const offenders = sourceFiles.filter((file) =>
    brokerPaths.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    offenders.map(rel),
    [],
    "a request to a broker's trade API is a code path that can move money",
  );
});

/**
 * The MCP surface is the one place a model could reach for a tool by name, so
 * an execution tool must not exist there in ANY form — registered, catalogued,
 * or merely described. A definition nobody registered still advertises a
 * capability the model will plan around.
 */
test("the MCP server neither registers nor advertises an execution tool", async () => {
  const { TOOL_CATALOG } = (await import(
    path.join(REPO, "mcp", "src", "tools", "schemas", "index.ts")
  )) as { TOOL_CATALOG: Array<{ name: string; description: string }> };

  const executionNames =
    /^(open_trade|close_trade|close_partial|modify_sl_tp|cancel_mt5_order|place_order|request_approval|respond_approval|get_pending_approvals|get_trade_readiness)$/;
  assert.deepEqual(
    TOOL_CATALOG.map((tool) => tool.name).filter((name) => executionNames.test(name)),
    [],
    "the catalogue is what a connected model reads to learn what it can do",
  );

  // A surviving tool must not INSTRUCT the model toward one either — that is
  // how create_recommendation ended up telling models to call open_trade next.
  const instructing = TOOL_CATALOG.filter((tool) =>
    /\b(open_trade|request_approval|respond_approval|get_trade_readiness)\b/.test(
      tool.description,
    ),
  ).map((tool) => tool.name);
  assert.deepEqual(instructing, [], "a description that names a deleted tool is an instruction to call it");
});

/**
 * No route may accept an execution request.
 *
 * Checked by path shape rather than by handler contents: a route that exists is
 * reachable, and "it does not do anything yet" is exactly how the surfaces this
 * migration deleted came to answer 404 in the operator's hands.
 */
test("no API route exists to accept an execution request", () => {
  const api = path.join(SRC, "app", "api");
  const forbidden = /\/(trades?|intents?|execute|orders?|positions?)(\/|$)/;
  const offenders = walk(api)
    .filter((file) => /route\.(ts|js)$/.test(file))
    .map((file) => path.relative(api, path.dirname(file)))
    .filter((route) => forbidden.test(`/${route}`));
  assert.deepEqual(
    offenders,
    [],
    "an execution route that exists is an execution route that can be called",
  );
});

/**
 * The decision contract itself.
 *
 * Even with every transport gone, a plan that carried a "place this" flag would
 * be one integration away from being acted on. The synthesizer's schema offers
 * a direction and levels, and nothing that commands.
 */
test("the decision contract cannot express an order", () => {
  const synth = readFileSync(
    path.join(SRC, "lib", "agent", "agents", "finalDecisionSynthesizer.ts"),
    "utf8",
  );
  for (const field of ["volume", "lots", "lotSize", "orderTicket", "executeNow"]) {
    assert.doesNotMatch(
      synth,
      new RegExp(`\\b${field}\\s*:`),
      `the plan schema must not carry ${field} — a size is the last thing between a plan and an order`,
    );
  }
});

/**
 * The persistence layer.
 *
 * This arm exists because the four above ALL PASSED while `trade_intents` and
 * `trades` were still in the schema, nineteen store helpers still read and
 * wrote them, `orderPlan.ts` still planned market-vs-limit fills, and
 * `intentRevalidate.ts` still re-checked approvals before execution. None of it
 * had a caller, and none of it was reachable — but "unreachable" is a fact
 * about today's call graph, and the guard is supposed to be about the product.
 *
 * Transports and routes were checked; the DATA PLANE was not. An order needs
 * somewhere to be recorded, so a schema that can record one is a schema this
 * product has no use for.
 */
test("no table exists to record an order or an approval to place one", () => {
  for (const backend of ["sqlite.ts", "pg.ts"]) {
    const schema = readFileSync(path.join(SRC, "lib", "db", backend), "utf8");
    for (const table of ["trade_intents", "trades"]) {
      assert.doesNotMatch(
        schema,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
        `${backend} still defines ${table} — a place to record an order`,
      );
    }
  }
});

test("the store cannot read or write an order", () => {
  // Named on the SQL rather than the function name, because the helper names
  // (`getIntent`, `listOpenTrades`) are the part a refactor renames and the
  // table is the part the product decides.
  const store = readFileSync(path.join(SRC, "lib", "store.ts"), "utf8");
  assert.doesNotMatch(store, /\bFROM trade_intents\b|\bINTO trade_intents\b|UPDATE trade_intents\b/);
  assert.doesNotMatch(store, /\bFROM trades\b|\bINTO trades\b|UPDATE trades\b/);
});

/**
 * Order PLANNING.
 *
 * A module that decides market-versus-limit and computes a limit price has
 * produced everything an order needs except the send. `orderPlan.ts` did
 * exactly that, with no caller, for the whole migration — the last step before
 * an order, sitting ready.
 */
test("nothing decides an order type or a limit price", () => {
  const offenders = sourceFiles
    // The strategy catalogue is the BACKTESTER's spec: its `order_type` says
    // how a simulated fill is priced against historical bars
    // (`price_reference: "next_bar_open"`), which is a statement about
    // arithmetic on candles, not an instruction to a broker. It carries no live
    // price and no account. Excluded by name rather than by loosening the
    // pattern, so a real order planner reappearing anywhere else still fails.
    .filter((file) => !/strategies[\\/]catalog\.ts$/.test(file))
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      // `order_type` as a FIELD being assigned or typed — not the words in prose.
      return /\border_type\s*:\s*["']?(?:market|limit)|limit_price\s*:/.test(text);
    });
  assert.deepEqual(
    offenders.map(rel),
    [],
    "planning the order is the last step before placing it",
  );
});

/**
 * Position sizing.
 *
 * The platform holds no equity and computes no lots, so a sizing helper here
 * could only be feeding something that places orders. Risk per Trade survives
 * as the operator's own R-expression, which is why the check names lot maths
 * rather than the setting.
 */
test("nothing computes a position size from an account balance", () => {
  const offenders = sourceFiles.filter((file) => {
    const text = readFileSync(file, "utf8");
    return /\b(calculateLots|computeLotSize|lotsFromRisk|positionSizeFromEquity)\b/.test(text);
  });
  assert.deepEqual(
    offenders.map(rel),
    [],
    "a lot size is only useful to something that places an order",
  );
});
