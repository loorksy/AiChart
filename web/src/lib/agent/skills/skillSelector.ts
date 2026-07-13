import type { AgentSkillDescriptor, AgentSkillSelectionContext } from "./types";

export function selectAgentSkills(
  skills: readonly AgentSkillDescriptor[],
  context: AgentSkillSelectionContext,
): AgentSkillDescriptor[] {
  const request = context.request.toLocaleLowerCase();
  const available = new Set(context.availableTools ?? []);
  return skills
    .filter(({ metadata }) => metadata.enabled)
    .filter(({ metadata }) => !metadata.supportedLocales?.length || !context.locale || metadata.supportedLocales.includes(context.locale))
    .filter(({ metadata }) => !metadata.allowedMarkets?.length || !context.market || metadata.allowedMarkets.map((m) => m.toLowerCase()).includes(context.market.toLowerCase()))
    .filter(({ metadata }) => !metadata.requiredTools?.length || metadata.requiredTools.every((tool) => available.has(tool)))
    .filter(({ metadata }) => !metadata.forbiddenTools?.some((tool) => available.has(tool)))
    .filter(({ metadata }) => metadata.riskLevel !== "execution" || context.allowExecutionSkills === true)
    .map((skill) => {
      const terms = [skill.metadata.name, skill.metadata.category, ...(skill.metadata.tags ?? [])]
        .flatMap((value) => value.toLocaleLowerCase().split(/[-_\s]+/))
        .filter((value) => value.length > 2);
      const keywordScore = terms.filter((term) => request.includes(term)).length;
      const intentScore = (context.intent ?? []).some((intent) =>
        intent.includes(skill.metadata.category) || terms.some((term) => intent.includes(term))) ? 3 : 0;
      return { skill, score: keywordScore + intentScore };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.skill.metadata.name.localeCompare(b.skill.metadata.name))
    .slice(0, Math.max(1, Math.min(context.maxSkills ?? 4, 4)))
    .map(({ skill }) => skill);
}
