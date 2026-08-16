import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AgentSkillLoader,
  AgentSkillRegistry,
  createDefaultAgentSkillRegistry,
  createReadOnlySkillAdapter,
  selectAgentSkills,
} from "..";

function addSkill(root: string, directory: string, header: string, body = "Body العربية") {
  const dir = join(root, directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${header}\n---\n\n${body}`, "utf8");
  return dir;
}

test("discovers repository skills in deterministic metadata-only order", () => {
  const registry = createDefaultAgentSkillRegistry();
  const names = registry.discover().map(({ metadata }) => metadata.name);
  assert.deepEqual(names, [...names].sort());
  for (const name of ["aichart-trading", "cards", "pattern-atlas", "trading-strategies"]) {
    assert.ok(names.includes(name));
  }
  assert.ok(!names.includes("trading-lexicon"));
});

test("invalid and duplicate skills are rejected without breaking startup", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-"));
  addSkill(root, "valid", "name: valid-skill\nversion: 1.0.0\ndescription: Valid skill");
  addSkill(root, "duplicate", "name: valid-skill\nversion: 1.0.0\ndescription: Duplicate");
  addSkill(root, "missing", "version: 1.0.0\ndescription: Missing name");
  const registry = new AgentSkillRegistry([{ path: root, trust: "reviewed" }]);
  assert.equal(registry.discover().length, 1);
  assert.ok(registry.getIssues().some(({ code }) => code === "DUPLICATE_SKILL"));
  assert.ok(registry.getIssues().some(({ code }) => code === "INVALID_SKILL"));
});

test("body is lazy-loaded and supporting-file traversal is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-"));
  const dir = addSkill(root, "lazy", "name: lazy-skill\nversion: 1.0.0\ndescription: Lazy body");
  writeFileSync(join(dir, "reference.md"), "safe reference", "utf8");
  writeFileSync(join(root, "outside.md"), "outside", "utf8");
  const registry = new AgentSkillRegistry([{ path: root, trust: "reviewed" }]);
  registry.discover();
  const loader = new AgentSkillLoader(registry);
  assert.match(loader.load("lazy-skill").content, /العربية/);
  assert.equal(loader.loadSupportingFile("lazy-skill", "reference.md"), "safe reference");
  assert.throws(() => loader.loadSupportingFile("lazy-skill", "../outside.md"));
});

test("selector filters locale, market, tools and execution trust", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-"));
  addSkill(root, "analysis", "name: gold-analysis\nversion: 1.0.0\ndescription: Gold analysis\ncategory: analysis\nriskLevel: analysis\nsupportedLocales: [\"ar\"]\nallowedMarkets: [\"forex\"]\nrequiredTools: [\"market_snapshot\"]\ntags: [\"gold\"]");
  addSkill(root, "execution", "name: gold-execution\nversion: 1.0.0\ndescription: Gold execution\ncategory: execution\nriskLevel: execution\nrequiredTools: [\"open_trade\"]\ntags: [\"gold\"]");
  const registry = new AgentSkillRegistry([{ path: root, trust: "user" }]);
  const skills = registry.discover();
  const selected = selectAgentSkills(skills, {
    request: "تحليل gold", locale: "ar", market: "forex", availableTools: ["market_snapshot", "open_trade"],
  });
  assert.deepEqual(selected.map(({ metadata }) => metadata.name), ["gold-analysis"]);
  assert.equal(skills.find(({ metadata }) => metadata.name === "gold-execution")?.metadata.trust, "user");
});

test("read-only MCP adapter uses the same registry and cannot grant permissions", () => {
  const registry = createDefaultAgentSkillRegistry();
  registry.discover();
  const loader = new AgentSkillLoader(registry);
  const adapter = createReadOnlySkillAdapter(registry, loader);
  assert.deepEqual(
    adapter.list_agent_skills().map(({ name }) => name),
    registry.list().map(({ metadata }) => metadata.name),
  );
  assert.match(adapter.load_agent_skill({ name: "trading-strategies" }).content, /Evidence Catalogue/);
  assert.equal("execute" in adapter, false);
});

test("cache invalidation re-discovers development changes", () => {
  const root = mkdtempSync(join(tmpdir(), "skills-"));
  addSkill(root, "one", "name: skill-one\nversion: 1.0.0\ndescription: One");
  const registry = new AgentSkillRegistry([{ path: root, trust: "reviewed" }]);
  assert.equal(registry.discover().length, 1);
  addSkill(root, "two", "name: skill-two\nversion: 1.0.0\ndescription: Two");
  assert.equal(registry.discover().length, 1);
  registry.invalidate();
  assert.equal(registry.discover().length, 2);
});
