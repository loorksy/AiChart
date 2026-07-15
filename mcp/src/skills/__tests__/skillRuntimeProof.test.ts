/**
 * Runtime proof: MCP skill discovery → selection → lazy load → stub resources.
 * Success requires evidence of actual catalogue behaviour — not file existence alone.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverSkills, loadSkill } from "../catalog.js";
import { selectMcpSkills, skillResourceStub } from "../select.js";

describe("MCP skill runtime proof", () => {
  it("discovers the canonical catalogue (metadata only)", () => {
    const { skills, root } = discoverSkills();
    assert.ok(root, "catalogue root must resolve");
    assert.ok(skills.length >= 4, `expected >=4 skills, got ${skills.length}`);
    const names = skills.map((s) => s.metadata.name).sort();
    assert.ok(names.includes("trading-lexicon"));
    assert.ok(names.includes("trading-strategies"));
    assert.ok(names.includes("cards"));
    assert.ok(names.includes("aichart-trading"));
    for (const s of skills) {
      assert.ok(s.skillFile.endsWith("SKILL.md"));
      assert.ok(s.metadata.description.length > 0);
    }
  });

  it("selects relevant skills and rejects irrelevant / execution ones", () => {
    const { skills } = discoverSkills();
    const analysis = selectMcpSkills(skills, {
      request: "analyze EURUSD structure and give a trade recommendation",
      intents: ["analysis", "recommendation"],
      market: "forex",
      availableTools: ["render_cards"],
      maxSkills: 2,
      allowExecutionSkills: false,
    });
    assert.ok(analysis.discovered >= 4);
    assert.ok(analysis.selected.length >= 1);
    assert.ok(
      analysis.selected.some((s) =>
        ["trading-lexicon", "trading-strategies"].includes(s.name),
      ),
      `expected lexicon/strategies, got ${JSON.stringify(analysis.selected.map((s) => s.name))}`,
    );
    assert.ok(
      analysis.rejected.some(
        (r) =>
          r.name === "aichart-trading" &&
          r.reason === "execution_skill_not_authorized",
      ),
      "execution skill must be rejected without authorization",
    );

    const greeting = selectMcpSkills(skills, {
      request: "hello how are you",
      intents: ["general"],
      market: "forex",
    });
    assert.equal(greeting.selected.length, 0);
    assert.ok(greeting.rejected.length >= 1);
  });

  it("lazily loads only when loadSkill is called — stubs never contain bodies", () => {
    const { skills } = discoverSkills();
    const meta = skills.find((s) => s.metadata.name === "trading-lexicon")!;
    const stub = skillResourceStub(meta.metadata);
    assert.match(stub, /not.*loaded skill/i);
    assert.match(stub, /load_agent_skill/);
    const loaded = loadSkill("trading-lexicon");
    assert.ok(loaded.content.length > 200, "real skill body must have content");
    assert.ok(
      stub.length < loaded.content.length,
      "resource stub must not embed the full skill body",
    );
    assert.equal(loaded.metadata.name, "trading-lexicon");
  });

  it("manual attachment is unnecessary — resolve returns selection evidence", () => {
    const { skills } = discoverSkills();
    const selection = selectMcpSkills(skills, {
      request: "بطاقة بطاقات card widget layout",
      availableTools: ["render_cards"],
      maxSkills: 2,
    });
    const names = selection.selected.map((s) => s.name);
    assert.ok(
      names.includes("cards") || selection.rejected.some((r) => r.name === "cards"),
      "cards must appear in selected or rejected with an explicit reason",
    );
  });
});
