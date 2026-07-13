import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AgentSkillRegistry } from "./skillRegistry";

export function defaultSkillRoot(): string {
  const candidates = [
    resolve(process.cwd(), "..", "agent", "workspace", "skills"),
    resolve(process.cwd(), "agent", "workspace", "skills"),
  ];
  return candidates.find(existsSync) ?? candidates[0]!;
}

export function createDefaultAgentSkillRegistry(): AgentSkillRegistry {
  return new AgentSkillRegistry([{ path: defaultSkillRoot(), trust: "reviewed", category: "trading" }]);
}
