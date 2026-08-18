/**
 * One instrument, structurally.
 *
 * `goldOnly.test.ts` pins the CONTRACT — what `requireGold` does, what the
 * timeframes are. This file pins the SHAPE of the codebase around it, because
 * gold-only is the kind of property that erodes by addition rather than by
 * edit: a second symbol arrives in a picker, a fixture, a default parameter,
 * and nothing about the existing tests notices.
 *
 * Every check here is about a place where a second instrument could enter and
 * be SERVED. Prose that mentions EURUSD in a comment about history is not a
 * defect; a symbol the operator can select is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_SYMBOL, OANDA_INSTRUMENT, TIMEFRAMES } from "@/lib/gold";
import { STORED_TIMEFRAMES } from "@/lib/gold/candleStore";

const SRC = path.join(import.meta.dirname, "..", "..");
const SKIP = new Set(["node_modules", ".next", "dist", "__tests__"]);

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

/** Instruments this platform does not cover, in the spellings a picker uses. */
const OTHER_INSTRUMENTS =
  /\b(EUR_?USD|GBP_?USD|USD_?JPY|AUD_?USD|USD_?CHF|NZD_?USD|USD_?CAD|BTC_?USD|ETH_?USD|XAG_?USD)\b/;

test("the store keeps one instrument and no symbol dimension", () => {
  // A symbol column is an invitation to store a second instrument. The schema
  // is where gold-only either holds or quietly stops holding.
  const sqlite = readFileSync(path.join(SRC, "lib", "db", "sqlite.ts"), "utf8");
  const table = sqlite.slice(
    sqlite.indexOf("CREATE TABLE IF NOT EXISTS gold_candles"),
  );
  const body = table.slice(0, table.indexOf(");"));
  assert.doesNotMatch(body, /\bsymbol\b/, "gold_candles must have no symbol column");
  assert.match(body, /PRIMARY KEY \(timeframe, time\)/);
});

test("the analysed frames and the stored frames agree", () => {
  // A frame the agent analyses but the store never keeps is a strategy that
  // can never be backtested; the reverse is history nobody reads.
  for (const frame of TIMEFRAMES) {
    assert.ok(
      STORED_TIMEFRAMES.includes(frame),
      `${frame} is analysed but not stored — no backtest can ever cover it`,
    );
  }
  // 1d is the one deliberate extra: context above the top analysed frame.
  assert.deepEqual([...STORED_TIMEFRAMES], [...TIMEFRAMES, "1d"]);
});

test("the OANDA spelling appears only where the boundary needs it", () => {
  // XAU_USD is the provider's name for the instrument. It belongs at the
  // provider boundary and nowhere else; leaking it inward is how two spellings
  // of one instrument start disagreeing.
  const offenders = walk(path.join(SRC, "lib"))
    .filter((file) => readFileSync(file, "utf8").includes(OANDA_INSTRUMENT))
    .map((file) => path.relative(SRC, file))
    .filter((file) => !/gold\.ts$|markets[\\/]/.test(file));
  assert.deepEqual(offenders, [], "the provider spelling must stay at the provider boundary");
});

test("no user-facing surface offers a second instrument", () => {
  // The picker, the default, the placeholder: the three ways an operator ends
  // up looking at a market this platform does not analyse.
  const offenders: string[] = [];
  for (const file of walk(path.join(SRC, "components"))) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      // Comments recording history are not a surface.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (OTHER_INSTRUMENTS.test(line)) {
        offenders.push(`${path.relative(SRC, file)}: ${line.trim().slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "an instrument the operator can pick is an instrument the platform must cover");
});

test("the candle store submits gold and nothing else", () => {
  for (const file of ["gold/candleStore.ts"]) {
    const text = readFileSync(path.join(SRC, "lib", file), "utf8");
    assert.match(text, /DATA_SYMBOL/, `${file} must take its symbol from lib/gold`);
    for (const line of text.split("\n")) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      assert.doesNotMatch(line, OTHER_INSTRUMENTS, `${file} names another instrument`);
    }
  }
});

test("the research exporter refuses a symbol it was not built for", () => {
  const exporter = readFileSync(path.join(SRC, "lib", "research", "warehouse.ts"), "utf8");
  // Refusing is the point: answering a EURUSD request with gold bars would be
  // worse than refusing, and silently coercing worse still.
  assert.match(exporter, /symbol !== DATA_SYMBOL/);
  assert.match(exporter, /supports \$\{DATA_SYMBOL\} only/);
});

test("gold's identity has exactly one definition", () => {
  const gold = readFileSync(path.join(SRC, "lib", "gold.ts"), "utf8");
  assert.match(gold, new RegExp(`DATA_SYMBOL = "${DATA_SYMBOL}"`));
  assert.match(gold, new RegExp(`OANDA_INSTRUMENT = "${OANDA_INSTRUMENT}"`));

  // A second hard-coded "XAUUSD" outside lib/gold is a second definition that
  // will eventually disagree with the first.
  const offenders = walk(path.join(SRC, "lib"))
    .filter((file) => !/gold\.ts$/.test(file))
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      return text.split("\n").some(
        (line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /"XAUUSD"/.test(line),
      );
    })
    .map((file) => path.relative(SRC, file))
    // The markets layer maps provider spellings and legitimately names both.
    .filter((file) => !file.startsWith("markets/") && !file.startsWith("strategies/matchingKeys"));
  assert.deepEqual(offenders, [], "import DATA_SYMBOL instead of re-typing the symbol");
});
