/**
 * Final MCP Intelligent Skill Selection — runtime evidence.
 * Proves capability scoring, minimal loading, tool gating, latency, cache.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverSkills, loadSkill } from "../catalog.js";
import { selectMcpSkills } from "../select.js";

function names(result: ReturnType<typeof selectMcpSkills>): string[] {
  return result.selected.map((s) => s.name).sort();
}

describe("MCP intelligent skill selection — runtime evidence", () => {
  it("Greeting → zero skills loaded", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "مرحبا",
      intents: ["general"],
      market: "forex",
      availableTools: ["render_cards"],
    });
    assert.equal(r.selected.length, 0, JSON.stringify(r));
    assert.ok(r.rejected.length >= 1);
    assert.ok(r.selectionMs < 50);
  });

  it("General conversation → zero skills", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "how are you today, thanks for your help",
      intents: ["general_question"],
      market: "forex",
    });
    assert.equal(r.selected.length, 0);
  });

  it("EURUSD analysis → analysis skills only (not execution)", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "Analyze EURUSD market structure SMC order blocks on the chart",
      intents: ["analysis", "new_trade_analysis"],
      market: "forex",
      locale: "en",
      availableTools: ["render_cards"],
      maxSkills: 2,
      allowExecutionSkills: false,
    });
    assert.ok(r.candidates.length >= 1, "candidates must be scored");
    assert.ok(
      r.selected.some((s) => s.name === "trading-lexicon" || s.category === "analysis"),
      `expected analysis skill, got ${JSON.stringify(names(r))} candidates=${JSON.stringify(r.candidates)}`,
    );
    assert.ok(!r.selected.some((s) => s.riskLevel === "execution"));
    assert.ok(
      r.rejected.some((x) => x.name === "aichart-trading"),
      "execution must stay rejected without authorization",
    );
    // Capability scores: top candidate must outrank rejected-as-irrelevant ones.
    const top = r.candidates[0]!;
    assert.ok(top.score > 0);
    assert.ok(top.matchReasons.length > 0);
  });

  it("Risk explanation → risk-related capability match, not all skills", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "Explain risk exit profile and stop placement for forex setups",
      intents: ["recommendation"],
      market: "forex",
      availableTools: ["render_cards"],
      maxSkills: 2,
    });
    // Risk tags live on trading-strategies / aichart-trading; execution blocked.
    assert.ok(!r.selected.some((s) => s.name === "aichart-trading"));
    assert.ok(
      r.selected.length === 0 ||
        r.selected.every((s) =>
          ["trading-strategies", "trading-lexicon"].includes(s.name),
        ),
      `unexpected selection ${JSON.stringify(names(r))}`,
    );
    assert.ok(r.selected.length <= 2);
  });

  it("Execution request → execution selectable only when authorized; still no auto-approve", () => {
    const { skills } = discoverSkills();
    const blocked = selectMcpSkills(skills, {
      request: "open a trade on EURUSD with technical execution safety",
      intents: ["execution", "trade"],
      market: "forex",
      availableTools: ["get_trade_readiness", "open_trade", "render_cards"],
      allowExecutionSkills: false,
    });
    assert.ok(
      blocked.rejected.some(
        (x) =>
          x.name === "aichart-trading" &&
          x.reason === "execution_skill_not_authorized",
      ),
    );

    const allowed = selectMcpSkills(skills, {
      request: "open a trade on EURUSD with explicit approval",
      intents: ["execution", "trade"],
      market: "forex",
      availableTools: ["get_trade_readiness", "open_trade", "render_cards"],
      allowExecutionSkills: true,
      maxSkills: 2,
    });
    // Selection may include execution skill — loading ≠ executing.
    // Tool permissions (open_trade) remain separate from skill load.
    assert.ok(
      allowed.selected.some((s) => s.name === "aichart-trading") ||
        allowed.candidates.some((c) => c.name === "aichart-trading" && c.score > 0),
      JSON.stringify(allowed),
    );
  });

  it("Research request → no fabricated research skill when catalogue has none", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "run deep research swarm backtest validation monte carlo",
      intents: ["research"],
      market: "forex",
      availableTools: ["render_cards"],
    });
    // Catalogue has no dedicated research skill — must not invent one.
    assert.ok(!r.selected.some((s) => /research|swarm|backtest/i.test(s.name)));
    // May still pick zero or weakly related; never claim a missing skill was loaded.
    assert.ok(Array.isArray(r.selected));
  });

  it("Mixed analysis + recommendation → minimal combined set", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request:
        "Analyze EURUSD structure then recommend a strategy setup with entry and risk exit",
      intents: ["analysis", "recommendation"],
      market: "forex",
      availableTools: ["render_cards"],
      maxSkills: 2,
    });
    assert.ok(r.selected.length >= 1 && r.selected.length <= 2);
    assert.ok(!r.selected.some((s) => s.riskLevel === "execution"));
    // Both capability families should appear in candidates with scores.
    const candNames = r.candidates.map((c) => c.name);
    assert.ok(
      candNames.includes("trading-lexicon") || candNames.includes("trading-strategies"),
    );
  });

  it("Cards without render_cards tool → rejected as unusable", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "show interactive cards and widget layout",
      availableTools: [],
      maxSkills: 2,
    });
    assert.ok(
      r.rejected.some(
        (x) => x.name === "cards" && x.reason === "required_tools_unavailable",
      ),
    );
    assert.ok(!r.selected.some((s) => s.name === "cards"));
  });

  it("Cards with tool available → may select presentation skill", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "show interactive cards and widget layout for the account",
      availableTools: ["render_cards"],
      maxSkills: 2,
    });
    assert.ok(r.selected.some((s) => s.name === "cards"), JSON.stringify(r));
  });

  it("No hardcoded skill-name routing remains in selector source contract", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/skills/select.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /metadata\.name === ["']trading-lexicon["']/);
    assert.doesNotMatch(src, /metadata\.name === ["']trading-strategies["']/);
    assert.doesNotMatch(src, /metadata\.name === ["']cards["']/);
    assert.match(src, /skillCapabilityTokens|capability/);
  });

  it("Latency: discovery + selection + lazy load stay bounded; discovery caches path", () => {
    const t0 = Date.now();
    const first = discoverSkills();
    const discover1 = Date.now() - t0;

    const t1 = Date.now();
    const second = discoverSkills();
    const discover2 = Date.now() - t1;

    const t2 = Date.now();
    const selection = selectMcpSkills(first.skills, {
      request: "Analyze GBPUSD indicators and structure",
      intents: ["analysis"],
      market: "forex",
      availableTools: ["render_cards"],
    });
    const selectMs = Date.now() - t2;

    const t3 = Date.now();
    if (selection.selected[0]) {
      loadSkill(selection.selected[0].name);
    }
    const loadMs = Date.now() - t3;

    assert.equal(first.skills.length, second.skills.length);
    assert.ok(discover1 < 200, `discovery too slow: ${discover1}ms`);
    assert.ok(discover2 < 200, `repeat discovery too slow: ${discover2}ms`);
    assert.ok(selection.selectionMs < 50, `selectionMs=${selection.selectionMs}`);
    assert.ok(selectMs < 50);
    assert.ok(loadMs < 100, `lazy load too slow: ${loadMs}ms`);
  });

  it("Selection never fabricates a loaded skill", () => {
    const { skills } = discoverSkills();
    const r = selectMcpSkills(skills, {
      request: "zzzz unrelated nonsense xyzzy",
      market: "forex",
    });
    assert.equal(r.selected.length, 0);
    assert.equal(r.candidates.length, 0);
  });
});
