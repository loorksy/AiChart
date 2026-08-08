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

/**
 * Two flavors of a persisted proposal now that `generate_strategy` defaults
 * to the sandboxed-code path (plan §4/§5) while the DSL path stays fully
 * present as an alternative, still-usable mechanism. Discriminated on
 * `mode`, which mirrors `strategy.generation_mode` from the server 1:1 —
 * kept snake_case-free but otherwise undecorated here (not camelCased) for
 * the same reason `GeneratedQuantStrategyRecord` itself isn't: this shape
 * composes the server's fields directly rather than re-mapping them.
 */
export type QuantAgentStrategyProposal =
  | { status: "persisted"; mode: "declarative"; strategy: GeneratedQuantStrategyRecord; spec: GeneratedStrategySpec }
  | { status: "persisted"; mode: "sandboxed_code"; strategy: GeneratedQuantStrategyRecord; code: string }
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
