/**
 * Capability-driven skill selection for the MCP catalogue.
 *
 * Flow: request → capability signals → discover candidates → score → rank →
 * minimal select → (caller) lazy load. No skill-name if/else routing.
 */
import type { McpSkillDescriptor, McpSkillMetadata } from "./catalog.js";

export interface McpSkillSelectionInput {
  request: string;
  /** Soft intent hints (optional) — e.g. analysis, recommendation, cards. */
  intents?: string[];
  locale?: string;
  market?: string;
  availableTools?: string[];
  maxSkills?: number;
  allowExecutionSkills?: boolean;
}

export interface McpSkillCandidateScore {
  name: string;
  score: number;
  /** Internal reasons only — never show to operators. */
  matchReasons: string[];
}

export interface McpSkillSelectionResult {
  selected: McpSkillMetadata[];
  rejected: Array<{ name: string; reason: string }>;
  /** Scored candidates that passed hard filters (internal diagnostics). */
  candidates: McpSkillCandidateScore[];
  discovered: number;
  /** Milliseconds for this selection call (diagnostics). */
  selectionMs: number;
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were",
  "you", "your", "our", "into", "onto", "about", "over", "under", "than",
  "then", "when", "what", "which", "while", "have", "has", "had", "will",
  "can", "may", "not", "any", "all", "via", "per", "use", "used", "using",
  "aichart", "skill", "skills", "guide", "complete", "comprehensive",
]);

/** Tokenize text into capability tokens (en + ar digits stripped). */
export function capabilityTokens(text: string): string[] {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/[-_]+/g, " ");
  const out: string[] = [];
  for (const raw of normalized.split(/\s+/)) {
    const t = raw.trim();
    if (t.length < 3) continue;
    if (STOP.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

function unique(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

/**
 * Capability vocabulary for a skill — derived from metadata only
 * (category, riskLevel, description, tags). Never hardcodes skill names.
 */
export function skillCapabilityTokens(metadata: McpSkillMetadata): string[] {
  return unique([
    ...capabilityTokens(metadata.category),
    ...capabilityTokens(metadata.riskLevel.replace(/_/g, " ")),
    ...capabilityTokens(metadata.description),
    ...(metadata.tags ?? []).flatMap((tag) => capabilityTokens(tag)),
    // Name tokens last — weak signal only (split hyphens), not a routing table.
    ...capabilityTokens(metadata.name.replace(/-/g, " ")),
  ]);
}

/**
 * Request/runtime capability signals — intent, mode, and free text.
 * Market/locale are hard filters (or soft boosts), not standalone match tokens,
 * otherwise every forex skill would load for a greeting when market=forex.
 */
export function requestCapabilityTokens(input: McpSkillSelectionInput): string[] {
  const parts = [
    input.request ?? "",
    ...(input.intents ?? []),
  ];
  return unique(parts.flatMap((p) => capabilityTokens(p)));
}

function overlapScore(
  requestTokens: readonly string[],
  skillTokens: readonly string[],
): { score: number; hits: string[] } {
  const skillSet = new Set(skillTokens);
  const hits: string[] = [];
  for (const t of requestTokens) {
    if (skillSet.has(t)) hits.push(t);
    // Prefix / stem-lite: "analyze"↔"analysis", "recommend"↔"recommendation"
    for (const s of skillTokens) {
      if (t === s) continue;
      if (t.length >= 4 && s.length >= 4 && (s.startsWith(t.slice(0, 4)) || t.startsWith(s.slice(0, 4)))) {
        if (!hits.includes(s)) hits.push(`~${s}`);
      }
    }
  }
  return { score: hits.length, hits: [...new Set(hits)].slice(0, 12) };
}

/**
 * Select which skills the runtime should load for this request.
 * Metadata only — does not load bodies. Capability-scored, not name-routed.
 */
export function selectMcpSkills(
  skills: readonly McpSkillDescriptor[],
  input: McpSkillSelectionInput,
): McpSkillSelectionResult {
  const started = Date.now();
  const requestTokens = requestCapabilityTokens(input);
  const available = new Set(input.availableTools ?? []);
  const intents = (input.intents ?? []).map((i) => i.toLocaleLowerCase());
  const rejected: Array<{ name: string; reason: string }> = [];
  const scored: Array<{
    skill: McpSkillDescriptor;
    score: number;
    matchReasons: string[];
  }> = [];

  for (const skill of skills) {
    const { metadata } = skill;
    if (!metadata.enabled) {
      rejected.push({ name: metadata.name, reason: "disabled" });
      continue;
    }
    if (
      metadata.supportedLocales?.length &&
      input.locale &&
      !metadata.supportedLocales.includes(input.locale)
    ) {
      rejected.push({ name: metadata.name, reason: "locale_mismatch" });
      continue;
    }
    if (
      metadata.allowedMarkets?.length &&
      input.market &&
      !metadata.allowedMarkets.map((m) => m.toLowerCase()).includes(input.market.toLowerCase())
    ) {
      rejected.push({ name: metadata.name, reason: "market_mismatch" });
      continue;
    }
    if (metadata.riskLevel === "execution" && input.allowExecutionSkills !== true) {
      rejected.push({ name: metadata.name, reason: "execution_skill_not_authorized" });
      continue;
    }
    if (
      metadata.requiredTools?.length &&
      !metadata.requiredTools.every((tool) => available.has(tool))
    ) {
      rejected.push({ name: metadata.name, reason: "required_tools_unavailable" });
      continue;
    }

    const skillTokens = skillCapabilityTokens(metadata);
    const { score: overlap, hits } = overlapScore(requestTokens, skillTokens);
    const matchReasons: string[] = [];
    let score = overlap;
    if (hits.length) matchReasons.push(`capability_overlap:${hits.slice(0, 6).join(",")}`);

    // Category/risk affinity with declared intents (capability dimension, not skill name).
    const categoryHit = intents.some(
      (intent) =>
        intent.includes(metadata.category) ||
        metadata.category.includes(intent) ||
        intent.includes(metadata.riskLevel.replace(/_/g, "")),
    );
    if (categoryHit) {
      score += 3;
      matchReasons.push(`intent_category:${metadata.category}`);
    }

    // Market affinity is a soft boost only after some request overlap exists.
    if (input.market && score > 0) {
      const marketToks = capabilityTokens(input.market);
      const m = overlapScore(marketToks, skillTokens);
      if (m.score > 0) {
        score += 1;
        matchReasons.push("market_affinity");
      }
    }

    if (score <= 0) {
      rejected.push({ name: metadata.name, reason: "not_relevant_to_request" });
      continue;
    }
    scored.push({ skill, score, matchReasons });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || a.skill.metadata.name.localeCompare(b.skill.metadata.name),
  );

  const max = Math.max(1, Math.min(input.maxSkills ?? 2, 4));
  // Minimal set: keep candidates within 50% of the top score (and score >= 1).
  const top = scored[0]?.score ?? 0;
  const threshold = top > 0 ? Math.max(1, Math.ceil(top * 0.5)) : 1;
  const withinBand = scored.filter((c) => c.score >= threshold);
  const selected = withinBand.slice(0, max).map(({ skill }) => skill.metadata);
  const selectedNames = new Set(selected.map((s) => s.name));

  for (const c of scored) {
    if (!selectedNames.has(c.skill.metadata.name)) {
      rejected.push({
        name: c.skill.metadata.name,
        reason:
          c.score < threshold ? "below_relevance_threshold" : "below_max_skills_cap",
      });
    }
  }

  return {
    selected,
    rejected,
    candidates: scored.map(({ skill, score, matchReasons }) => ({
      name: skill.metadata.name,
      score,
      matchReasons,
    })),
    discovered: skills.length,
    selectionMs: Math.max(0, Date.now() - started),
  };
}

/** Build a metadata-only markdown stub for a skill resource URI. */
export function skillResourceStub(metadata: McpSkillMetadata): string {
  return [
    `# Skill catalogue entry: ${metadata.name}`,
    "",
    "> This URI is **not** a loaded skill. Visible resources never inject skill bodies into context.",
    ">",
    `> To load content, call \`load_agent_skill\` with \`name: \"${metadata.name}\"\`.`,
    "",
    "## Metadata",
    "",
    `- **name**: ${metadata.name}`,
    `- **version**: ${metadata.version}`,
    `- **category**: ${metadata.category}`,
    `- **riskLevel**: ${metadata.riskLevel}`,
    `- **description**: ${metadata.description}`,
    metadata.tags?.length ? `- **tags**: ${metadata.tags.join(", ")}` : null,
    metadata.requiredTools?.length
      ? `- **requiredTools**: ${metadata.requiredTools.join(", ")}`
      : null,
    "",
    "Skills provide evidence only; they never override the model's market decision or technical execution authorization.",
  ]
    .filter((line) => line != null)
    .join("\n");
}
