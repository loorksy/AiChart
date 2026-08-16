import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDefaultAgentSkillRegistry } from "../defaultRegistry";
import { AgentSkillRegistry } from "../skillRegistry";
import {
  buildAgentSkillContext,
  setSkillContextRegistry,
} from "../skillContext";

function addSkill(root: string, directory: string, header: string, body = "Skill body content.") {
  const dir = join(root, directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${header}\n---\n\n${body}`, "utf8");
  return dir;
}

test.afterEach(() => setSkillContextRegistry(null));

test("a relevant skill loads for a matching market-analysis request", () => {
  setSkillContextRegistry(null);
  const context = buildAgentSkillContext({
    request: "حلل الذهب الآن وأعطني توصية",
    intent: ["new_trade_analysis"],
    locale: "ar",
    market: "forex",
    availableTools: [],
  });
  assert.ok(context.catalogueSize >= 4, "canonical catalogue must be discovered");
  const names = context.loaded.map(({ name }) => name);
  assert.ok(
    names.includes("trading-strategies") || names.includes("aichart-trading"),
    `expected an analysis/recommendation skill, got ${JSON.stringify(names)}`,
  );
  for (const skill of context.loaded) {
    assert.ok(skill.version, "loaded skills must record a version");
    assert.match(context.block, new RegExp(`## Skill: ${skill.name}@`));
  }
  assert.match(context.block, /NEVER grants permissions/);
});

test("irrelevant requests load no skills", () => {
  setSkillContextRegistry(null);
  const context = buildAgentSkillContext({
    request: "مرحبا كيف حالك اليوم",
    intent: ["general_question"],
    locale: "ar",
    market: "forex",
    availableTools: [],
  });
  assert.equal(context.loaded.length, 0);
  assert.equal(context.block, "");
});

test("aichart-trading is a recommendation skill and the catalogue has no execution skill", () => {
  const registry = createDefaultAgentSkillRegistry();
  const discovered = registry.discover();
  const trading = discovered.find(({ metadata }) => metadata.name === "aichart-trading");
  assert.ok(trading);
  assert.equal(trading.metadata.riskLevel, "recommendation");
  assert.equal(trading.metadata.category, "recommendation");
  assert.ok(
    !discovered.some(({ metadata }) => metadata.riskLevel === "execution"),
    "canonical catalogue must not ship an execution-risk skill",
  );
});

test("execution skills never load without explicit execution authorization", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-exec-"));
  addSkill(
    root,
    "exec",
    "name: leftover-execution\nversion: 1.0.0\ndescription: Leftover execution skill\ncategory: execution\nriskLevel: execution\nrequiredTools: [\"open_trade\"]\ntags: [\"execution\"]",
  );
  setSkillContextRegistry(new AgentSkillRegistry([{ path: root, trust: "reviewed" }]));
  const context = buildAgentSkillContext({
    request: "open trade now with execution safety",
    intent: ["trade_execution"],
    locale: "en",
    market: "forex",
    availableTools: ["open_trade"],
  });
  assert.ok(
    !context.loaded.some(({ name }) => name === "leftover-execution"),
    "execution-risk skill must not load in the chart-agent context",
  );
});

test("failed skill loads are reported honestly, not silently faked", () => {
  const root = mkdtempSync(join(tmpdir(), "skillctx-"));
  const dir = addSkill(
    root,
    "broken",
    "name: broken-analysis\nversion: 1.0.0\ndescription: Broken analysis skill\ncategory: analysis\nriskLevel: analysis\ntags: [\"analysis\"]",
  );
  const registry = new AgentSkillRegistry([{ path: root, trust: "reviewed" }]);
  registry.discover();
  // Remove the file after discovery so the lazy load fails.
  writeFileSync(join(dir, "SKILL.md"), "", "utf8");
  setSkillContextRegistry(registry);
  const context = buildAgentSkillContext({
    request: "run the broken analysis skill",
    intent: ["new_trade_analysis"],
    locale: "en",
    availableTools: [],
  });
  assert.equal(context.loaded.length, 0);
  assert.ok(
    context.failed.some(({ name }) => name === "broken-analysis"),
    "load failure must be reported by name",
  );
});

test("skill discovery failure degrades to zero skills without throwing", () => {
  const registry = new AgentSkillRegistry([{ path: "/nonexistent/skills", trust: "reviewed" }]);
  setSkillContextRegistry(registry);
  const context = buildAgentSkillContext({
    request: "analyze the market",
    intent: ["new_trade_analysis"],
    availableTools: [],
  });
  assert.equal(context.loaded.length, 0);
  assert.equal(context.block, "");
});
