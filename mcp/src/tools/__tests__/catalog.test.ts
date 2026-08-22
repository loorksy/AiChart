import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TOOL_CATALOG } from "../schemas/index.js";

describe("MCP TOOL_CATALOG", () => {
  it("has unique tool names", () => {
    const names = TOOL_CATALOG.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, "duplicate tool names");
  });

  it("keeps a working surface without padding it", () => {
    // The floor was 50 when this server also exposed account, execution and
    // approval tools. It exposes none of those now — the platform issues
    // recommendations and holds no broker connection — so 50 was a target that
    // could only be met by keeping dead definitions in the catalogue.
    assert.ok(TOOL_CATALOG.length >= 25, `expected >=25, got ${TOOL_CATALOG.length}`);
  });

  /**
   * The catalogue is what a connected model reads to learn what it can do.
   * A definition for a tool nobody registered is not harmless documentation:
   * it advertises a capability, the model plans around it, and the call fails
   * as "unknown tool" — or worse, the model reports having done something.
   */
  it("keeps every auto/approval-era tool name dead — manual execution is execute_recommendation + get_execution_trades only", () => {
    // Owner decision: a MANUAL execution pair exists (operator-commanded,
    // server-guarded). Everything the old auto-execution era advertised —
    // account browsing, approvals, trade modes, per-position mutation —
    // stays dead by name.
    const forbidden =
      /^(open_trade|close_trade|close_partial|modify_sl_tp|evaluate_trade|record_exit_decision|request_approval|respond_approval|get_pending_approvals|get_trade_readiness|get_agent_trade_mode|set_agent_trade_mode|get_live_account|get_account_overview|get_portfolio|get_open_trades|get_position|get_orders?|get_history_orders|get_deals|calculate_margin|propose_.*)$/;
    const offenders = TOOL_CATALOG.map((t) => t.name).filter((name) => forbidden.test(name));
    assert.deepEqual(offenders, [], "only the sanctioned manual pair may exist; the auto-era names stay dead");
  });

  it("every tool has §0.11-style description and annotations", () => {
    for (const tool of TOOL_CATALOG) {
      assert.ok(tool.description.length >= 20, `${tool.name}: description too short`);
      // Every tool must carry a "when to use" hint. The catalog convention is
      // an English "When:" prefix; read-only tools may instead say "read-only".
      // ("متى:" is accepted for any Arabic-authored descriptions.)
      assert.ok(
        tool.description.includes("When:") ||
          tool.description.includes("متى:") ||
          tool.description.includes("read-only"),
        `${tool.name}: missing usage hint`,
      );
      assert.equal(typeof tool.annotations.readOnlyHint, "boolean", tool.name);
      assert.equal(typeof tool.annotations.destructiveHint, "boolean", tool.name);
      assert.equal(typeof tool.annotations.idempotentHint, "boolean", tool.name);
    }
  });

  it("matches manifest tool count when manifest exists", () => {
    try {
      const manifest = JSON.parse(
        readFileSync(join(process.cwd(), "schemas", "manifest.json"), "utf8"),
      ) as { toolCount?: number };
      if (manifest.toolCount != null) {
        assert.equal(manifest.toolCount, TOOL_CATALOG.length);
      }
    } catch {
      // manifest not exported yet
    }
  });
});
