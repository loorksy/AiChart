import type { AgentSkillLoader } from "./skillLoader";
import type { AgentSkillRegistry } from "./skillRegistry";

export function createReadOnlySkillAdapter(registry: AgentSkillRegistry, loader: AgentSkillLoader) {
  return {
    list_agent_skills: () => registry.list().filter(({ metadata }) => metadata.enabled).map(({ metadata }) => metadata),
    load_agent_skill: (input: { name: string; version?: string }) => loader.load(input.name, input.version),
  } as const;
}
