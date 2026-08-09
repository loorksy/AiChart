import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AgentSkillRegistry } from "./skillRegistry";

/**
 * A second, independent skill root for Quant Agent Chat (plan §7).
 * `AgentSkillRegistry` already accepts an array of roots — a dedicated root
 * is the safer isolation choice over filtering a shared one: a Quant Agent
 * skill can never leak into Lonora's chat and vice versa, by construction.
 *
 * The root starts empty (no authored skills in v1) — the mechanism existing
 * and being wired into the orchestrator is what matters; see
 * docs/SKILL_SYSTEM.md for the SKILL.md format future skills here must use.
 */
export function quantAgentSkillRoot(): string {
  const candidates = [
    resolve(process.cwd(), "..", "agent", "workspace", "quant-agent", "skills"),
    resolve(process.cwd(), "agent", "workspace", "quant-agent", "skills"),
  ];
  return candidates.find(existsSync) ?? candidates[0]!;
}

export function createQuantAgentSkillRegistry(): AgentSkillRegistry {
  return new AgentSkillRegistry([
    { path: quantAgentSkillRoot(), trust: "reviewed", category: "quant_agent" },
  ]);
}
