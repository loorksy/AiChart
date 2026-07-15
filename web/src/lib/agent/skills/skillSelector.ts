/**
 * Capability-driven skill selection for the web agent catalogue.
 * Parity with MCP `selectMcpSkills` — no skill-name if/else routing.
 */
import type { AgentSkillDescriptor, AgentSkillSelectionContext } from "./types";

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were",
  "you", "your", "our", "into", "onto", "about", "over", "under", "than",
  "then", "when", "what", "which", "while", "have", "has", "had", "will",
  "can", "may", "not", "any", "all", "via", "per", "use", "used", "using",
  "aichart", "skill", "skills", "guide", "complete", "comprehensive",
]);

function tokens(text: string): string[] {
  const normalized = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .replace(/[-_]+/g, " ");
  const out: string[] = [];
  for (const raw of normalized.split(/\s+/)) {
    const t = raw.trim();
    if (t.length < 3 || STOP.has(t) || /^\d+$/.test(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

function skillTokens(metadata: AgentSkillDescriptor["metadata"]): string[] {
  return [
    ...tokens(metadata.category),
    ...tokens(metadata.riskLevel.replace(/_/g, " ")),
    ...tokens(metadata.description),
    ...(metadata.tags ?? []).flatMap((tag) => tokens(tag)),
    ...tokens(metadata.name.replace(/-/g, " ")),
  ];
}

function overlap(requestTokens: string[], skillToks: string[]): number {
  const set = new Set(skillToks);
  let score = 0;
  for (const t of requestTokens) {
    if (set.has(t)) {
      score += 1;
      continue;
    }
    for (const s of skillToks) {
      if (t.length >= 4 && s.length >= 4 && (s.startsWith(t.slice(0, 4)) || t.startsWith(s.slice(0, 4)))) {
        score += 1;
        break;
      }
    }
  }
  return score;
}

export function selectAgentSkills(
  skills: readonly AgentSkillDescriptor[],
  context: AgentSkillSelectionContext,
): AgentSkillDescriptor[] {
  const requestTokens = [
    ...tokens(context.request),
    ...(context.intent ?? []).flatMap((i) => tokens(i)),
  ];
  const available = new Set(context.availableTools ?? []);
  const intents = (context.intent ?? []).map((i) => i.toLocaleLowerCase());

  const scored = skills
    .filter(({ metadata }) => metadata.enabled)
    .filter(
      ({ metadata }) =>
        !metadata.supportedLocales?.length ||
        !context.locale ||
        metadata.supportedLocales.includes(context.locale),
    )
    .filter(
      ({ metadata }) =>
        !metadata.allowedMarkets?.length ||
        !context.market ||
        metadata.allowedMarkets.map((m) => m.toLowerCase()).includes(context.market.toLowerCase()),
    )
    .filter(
      ({ metadata }) =>
        !metadata.requiredTools?.length ||
        metadata.requiredTools.every((tool) => available.has(tool)),
    )
    .filter(
      ({ metadata }) =>
        !metadata.forbiddenTools?.some((tool) => available.has(tool)),
    )
    .filter(
      ({ metadata }) =>
        metadata.riskLevel !== "execution" || context.allowExecutionSkills === true,
    )
    .map((skill) => {
      const caps = skillTokens(skill.metadata);
      let score = overlap(requestTokens, caps);
      if (
        intents.some(
          (intent) =>
            intent.includes(skill.metadata.category) ||
            skill.metadata.category.includes(intent),
        )
      ) {
        score += 3;
      }
      // Market is a soft boost only after request/intent overlap.
      if (score > 0 && context.market) {
        score += overlap(tokens(context.market), caps) > 0 ? 1 : 0;
      }
      return { skill, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.skill.metadata.name.localeCompare(b.skill.metadata.name),
    );

  const max = Math.max(1, Math.min(context.maxSkills ?? 4, 4));
  const top = scored[0]?.score ?? 0;
  const threshold = top > 0 ? Math.max(1, Math.ceil(top * 0.5)) : 1;
  return scored
    .filter(({ score }) => score >= threshold)
    .slice(0, max)
    .map(({ skill }) => skill);
}
