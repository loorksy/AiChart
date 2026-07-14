import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { discoverSkills, loadSkill } from "../catalog.js";

describe("MCP canonical skill catalogue", () => {
  it("discovers the same canonical catalogue the web registry uses", () => {
    const { skills, root } = discoverSkills();
    assert.ok(root, "skill catalogue root must resolve from agent/workspace/skills");
    const names = skills.map(({ metadata }) => metadata.name);
    for (const expected of ["aichart-trading", "cards", "trading-lexicon", "trading-strategies"]) {
      assert.ok(names.includes(expected), `missing skill: ${expected}`);
    }
    // Deterministic metadata-first ordering, no bodies.
    assert.deepEqual(names, [...names].sort());
    for (const { metadata } of skills) {
      assert.ok(metadata.version, `${metadata.name}: version required`);
      assert.ok(metadata.description.length > 0, `${metadata.name}: description required`);
      assert.ok(metadata.riskLevel, `${metadata.name}: riskLevel required`);
    }
  });

  it("skill metadata matches the SKILL.md frontmatter on disk (web/MCP agreement)", () => {
    const { skills, root } = discoverSkills();
    assert.ok(root);
    for (const { metadata, skillFile } of skills) {
      const raw = readFileSync(skillFile, "utf8");
      assert.match(raw, new RegExp(`name:\\s*${metadata.name}`));
      assert.match(raw, new RegExp(`version:\\s*${metadata.version.replace(/\./g, "\\.")}`));
    }
  });

  it("loads a relevant skill's full content explicitly", () => {
    const loaded = loadSkill("trading-lexicon");
    assert.equal(loaded.metadata.name, "trading-lexicon");
    assert.ok(loaded.content.length > 500, "content must be the real skill body");
    assert.match(loaded.content, /Trading Lexicon/i);
  });

  it("reports missing skills honestly instead of pretending success", () => {
    assert.throws(() => loadSkill("nonexistent-skill"), /Skill not found/);
    assert.throws(() => loadSkill("trading-lexicon", "99.0.0"), /Skill not found/);
  });

  it("execution-risk skills stay marked so hosts cannot treat them as harmless", () => {
    const { skills } = discoverSkills();
    const trading = skills.find(({ metadata }) => metadata.name === "aichart-trading");
    assert.ok(trading);
    assert.equal(trading.metadata.riskLevel, "execution");
  });
});

describe("MCP skill tools are part of the canonical tool catalog", async () => {
  const { TOOL_CATALOG } = await import("../../tools/schemas/index.js");
  it("list_agent_skills and load_agent_skill are registered read-only tools", () => {
    for (const name of ["list_agent_skills", "load_agent_skill"]) {
      const def = TOOL_CATALOG.find((t) => t.name === name);
      assert.ok(def, `${name} missing from TOOL_CATALOG`);
      assert.equal(def.annotations.readOnlyHint, true, `${name} must be read-only`);
      assert.equal(def.annotations.destructiveHint, false, `${name} must be non-destructive`);
    }
  });
});
