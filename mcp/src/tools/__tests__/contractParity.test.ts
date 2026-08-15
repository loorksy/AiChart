import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TOOL_CATALOG } from "../schemas/index.js";

interface ContractTool {
  name: string;
  permission: string;
  riskClass: string;
  surfaces: string[];
  serverControlled: boolean;
  aliases: string[];
}

function loadContract(): { tools: ContractTool[] } {
  const path = join(process.cwd(), "..", "agent", "tools", "contract.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("MCP catalogue ↔ canonical tool contract parity", () => {
  const contract = loadContract();
  const byName = new Map(contract.tools.map((t) => [t.name, t]));

  it("every registered MCP tool exists in the canonical contract with surface mcp", () => {
    for (const def of TOOL_CATALOG) {
      const entry = byName.get(def.name);
      assert.ok(entry, `${def.name} missing from agent/tools/contract.json`);
      assert.ok(entry.surfaces.includes("mcp"), `${def.name} missing mcp surface`);
      assert.ok(entry.permission, `${def.name} needs a permission`);
      assert.ok(entry.riskClass, `${def.name} needs a riskClass`);
    }
  });

  it("read-only annotated tools are never classed as execution", () => {
    for (const def of TOOL_CATALOG) {
      if (def.annotations.readOnlyHint) {
        const entry = byName.get(def.name)!;
        assert.notEqual(entry.riskClass, "execution", def.name);
      }
    }
  });

  /**
   * This test used to require that open_trade, close_trade, close_partial,
   * cancel_mt5_order, modify_sl_tp and respond_approval each carried
   * riskClass "execution" and serverControlled — the right guard while those
   * tools existed. None of them does. The platform issues recommendations,
   * holds no broker connection and places no orders, so the guard that
   * replaces it is the stronger one: nothing on the mcp surface may be
   * execution-classed, because nothing on it can execute.
   */
  it("no tool on the mcp surface is execution-classed", () => {
    const offenders = contract.tools
      .filter((entry) => entry.surfaces.includes("mcp") && entry.riskClass === "execution")
      .map((entry) => entry.name);
    assert.deepEqual(offenders, [], "a recommendations-only surface has nothing to execute");
  });

  it("contract has no phantom mcp tools that are not actually registered", () => {
    const registered = new Set(TOOL_CATALOG.map((t) => t.name));
    for (const entry of contract.tools) {
      if (entry.surfaces.includes("mcp")) {
        assert.ok(registered.has(entry.name), `${entry.name} in contract but not registered`);
      }
    }
  });
});
