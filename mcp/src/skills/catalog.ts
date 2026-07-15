/**
 * Canonical skill catalogue for MCP — reads the SAME `agent/workspace/skills`
 * directory the web AgentSkillRegistry uses, so web and MCP can never drift.
 *
 * Discovery is metadata-first (frontmatter only); full content loads lazily
 * and explicitly through the `load_agent_skill` tool. A load either succeeds
 * with real file content or fails with an explicit error — the model must
 * never pretend a visible resource was read.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export interface McpSkillMetadata {
  name: string;
  version: string;
  description: string;
  category: string;
  riskLevel: "read_only" | "analysis" | "recommendation" | "execution";
  supportedLocales?: string[];
  allowedMarkets?: string[];
  requiredTools?: string[];
  /** Optional capability tags from frontmatter — used for scoring, not routing. */
  tags?: string[];
  enabled: boolean;
}

export interface McpSkillDescriptor {
  metadata: McpSkillMetadata;
  skillFile: string;
}

const RISK_LEVELS = new Set(["read_only", "analysis", "recommendation", "execution"]);

function skillRootCandidates(): string[] {
  return [
    join(process.cwd(), "..", "agent", "workspace", "skills"),
    join(process.cwd(), "agent", "workspace", "skills"),
  ];
}

function scalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    try { return JSON.parse(value); } catch { /* keep raw text */ }
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = text.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { frontmatter: {}, body: normalized };
  }
  const end = normalized.search(/\r?\n---\r?\n/);
  if (end < 0) return { frontmatter: {}, body: normalized };
  const header = normalized.slice(normalized.indexOf("\n") + 1, end);
  const frontmatter: Record<string, unknown> = {};
  for (const line of header.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match) frontmatter[match[1]!] = scalar(match[2]!);
  }
  const bodyStart = normalized.indexOf("\n", end + 5);
  return { frontmatter, body: bodyStart >= 0 ? normalized.slice(bodyStart + 1) : "" };
}

function strings(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
    return out.length ? out : undefined;
  }
  return undefined;
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function toMetadata(raw: Record<string, unknown>): McpSkillMetadata | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const version = typeof raw.version === "string" ? raw.version.trim() : "1.0.0";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) return null;
  if (!description) return null;
  const riskLevel = typeof raw.riskLevel === "string" && RISK_LEVELS.has(raw.riskLevel)
    ? (raw.riskLevel as McpSkillMetadata["riskLevel"])
    : "analysis";
  return {
    name,
    version,
    description,
    category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : "trading",
    riskLevel,
    supportedLocales: strings(raw.supportedLocales),
    allowedMarkets: strings(raw.allowedMarkets),
    requiredTools: strings(raw.requiredTools),
    tags: strings(raw.tags),
    enabled: raw.enabled !== false,
  };
}

/** Discover the canonical skill catalogue (metadata only, never bodies). */
export function discoverSkills(): { skills: McpSkillDescriptor[]; root: string | null } {
  for (const candidate of skillRootCandidates()) {
    let root: string;
    try { root = realpathSync(candidate); } catch { continue; }
    const skills: McpSkillDescriptor[] = [];
    let entries;
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      let dir: string;
      try { dir = realpathSync(join(root, entry.name)); } catch { continue; }
      if (!within(root, dir)) continue;
      const skillFile = join(dir, "SKILL.md");
      try {
        if (!statSync(skillFile).isFile()) continue;
      } catch { continue; }
      const header = readFileSync(skillFile, "utf8").slice(0, 16_384);
      const metadata = toMetadata(parseFrontmatter(header).frontmatter);
      if (metadata && metadata.enabled) skills.push({ metadata, skillFile });
    }
    return { skills, root };
  }
  return { skills: [], root: null };
}

const MAX_SKILL_CONTENT_CHARS = 20_000;

/** Load one skill's full content. Throws with an explicit reason on failure. */
export function loadSkill(name: string, version?: string): {
  metadata: McpSkillMetadata;
  content: string;
  truncated: boolean;
} {
  const { skills, root } = discoverSkills();
  if (!root) throw new Error("Skill catalogue directory not found (agent/workspace/skills).");
  const descriptor = skills
    .filter((s) => s.metadata.name === name && (!version || s.metadata.version === version))
    .at(-1);
  if (!descriptor) throw new Error(`Skill not found: ${name}${version ? `@${version}` : ""}`);
  const parsed = parseFrontmatter(readFileSync(descriptor.skillFile, "utf8"));
  const body = parsed.body.trim();
  if (!body) throw new Error(`Skill content is empty: ${name}`);
  const truncated = body.length > MAX_SKILL_CONTENT_CHARS;
  return {
    metadata: descriptor.metadata,
    content: truncated ? body.slice(0, MAX_SKILL_CONTENT_CHARS) : body,
    truncated,
  };
}
