import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { TOOLS } from "@/lib/agent";

interface ContractTool {
  name: string;
  permission: string;
  riskClass: string;
  surfaces: string[];
  serverControlled: boolean;
  executor: string;
  aliases: string[];
}

const contract: { tools: ContractTool[] } = JSON.parse(
  readFileSync(resolve(process.cwd(), "..", "agent", "tools", "contract.json"), "utf8"),
);

/** Resolve a web tool name to its canonical contract entry (name or alias). */
function contractEntry(name: string): ContractTool | undefined {
  return (
    contract.tools.find((t) => t.name === name) ??
    contract.tools.find((t) => t.aliases.includes(name))
  );
}

test("every web agent tool exists in the canonical contract (name or alias)", () => {
  for (const tool of TOOLS) {
    const entry = contractEntry(tool.name);
    assert.ok(entry, `${tool.name} missing from agent/tools/contract.json`);
    assert.ok(
      entry.surfaces.includes("web"),
      `${tool.name} → ${entry.name} lacks the web surface`,
    );
  }
});

test("high-risk execution tools stay server controlled in the web catalogue", () => {
  for (const name of ["open_trade", "close_trade", "modify_sl_tp"]) {
    const entry = contractEntry(name);
    assert.ok(entry, name);
    assert.equal(entry.riskClass, "execution", name);
    assert.equal(entry.serverControlled, true, name);
    // Execution always routes through the web API (Risk Guard path), never a
    // local in-process shortcut.
    assert.match(entry.executor, /bridge/, name);
  }
});

test("web open_trade schema requires the mandatory stop_loss", () => {
  const openTrade = TOOLS.find((t) => t.name === "open_trade");
  assert.ok(openTrade);
  const required = (openTrade.input_schema as { required?: string[] }).required ?? [];
  assert.ok(required.includes("stop_loss"), "open_trade must require stop_loss");
});

test("obsolete crypto-era tools are gone from the web catalogue", () => {
  const names = new Set(TOOLS.map((t) => t.name));
  for (const gone of ["get_account_balances", "connect_crypto", "get_futures_positions", "set_kill_switch"]) {
    assert.ok(!names.has(gone), `${gone} should no longer be exposed`);
  }
});

test("contract execution tools are never exposed as web-local executors", () => {
  for (const entry of contract.tools) {
    if (entry.riskClass === "execution") {
      assert.notEqual(entry.executor, "web-local", entry.name);
      assert.equal(entry.serverControlled, true, entry.name);
    }
  }
});
