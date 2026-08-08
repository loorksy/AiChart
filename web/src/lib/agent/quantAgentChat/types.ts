/**
 * Client-safe public types for Quant Agent Chat turns. Kept in a side-effect-
 * free module (no `node:fs`/`node:crypto`/DB imports) so browser components
 * can `import type` these without ever pulling `orchestrator.ts` — which
 * touches the DB and filesystem — into a client bundle.
 */
import type {
  GenerateValidateQuantStrategyError,
  GeneratedQuantStrategyRecord,
  GeneratedStrategySpec,
  QuantRecommendation,
} from "@/lib/quantAgent/types";
import type { QuantAgentChatIntent } from "./intentRouter";

export interface QuantAgentUsedSkill {
  name: string;
  version: string;
}

export interface QuantAgentMemoryCandidate {
  content: string;
}

export type QuantAgentStrategyProposal =
  | { status: "persisted"; strategy: GeneratedQuantStrategyRecord; spec: GeneratedStrategySpec }
  | { status: "invalid"; errors: GenerateValidateQuantStrategyError[] };

export interface QuantAgentChatTurnResult {
  chatId: string;
  intent: QuantAgentChatIntent;
  reply: string;
  memoryCandidate: QuantAgentMemoryCandidate | null;
  strategyProposal: QuantAgentStrategyProposal | null;
  recommendations: QuantRecommendation[];
  usedSkills: QuantAgentUsedSkill[];
}
