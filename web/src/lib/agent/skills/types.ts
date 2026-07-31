export type AgentSkillTrust = "system" | "reviewed" | "user";
export type AgentSkillRiskLevel = "read_only" | "analysis" | "recommendation" | "execution";

export interface AgentSkillMetadata {
  name: string;
  version: string;
  description: string;
  category: string;
  enabled: boolean;
  trust: AgentSkillTrust;
  supportedLocales?: Array<"ar" | "en">;
  allowedMarkets?: string[];
  requiredTools?: string[];
  forbiddenTools?: string[];
  riskLevel: AgentSkillRiskLevel;
  tags?: string[];
}

export interface AgentSkillDescriptor {
  metadata: AgentSkillMetadata;
  directory: string;
  skillFile: string;
}

export interface AgentSkillIssue {
  code: "INVALID_SKILL" | "DUPLICATE_SKILL" | "UNSAFE_PATH";
  path: string;
  message: string;
}

export interface AgentSkillSelectionContext {
  intent?: string[];
  request: string;
  locale?: "ar" | "en";
  market?: string;
  availableTools?: string[];
  maxSkills?: number;
  allowExecutionSkills?: boolean;
  /**
   * Pattern names the deterministic geometry engine ACTUALLY detected in the
   * running analysis (plan §11 F.1) — the selection key that pulls the atlas
   * in when there is a pattern to read about, instead of guessing from the
   * request text.
   */
  detectedPatterns?: string[];
}
