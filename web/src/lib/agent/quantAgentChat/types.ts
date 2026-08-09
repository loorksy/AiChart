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
  QuantBacktestResult,
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
 * Composer Coach (plan Feature B) — the assistant turn's payload for a step
 * of the guided `generate_strategy` wizard (or `null` when this turn isn't
 * part of one). `ready` marks the final confirm step (step 4): the wizard is
 * ready to submit, not that generation already ran. `suggestions` populate
 * the composer's draft text on click — they never auto-send.
 */
export interface ComposerCoach {
  title: string;
  description: string;
  ready: boolean;
  suggestions: { label: string; value: string }[];
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
  | {
      status: "persisted";
      mode: "declarative";
      strategy: GeneratedQuantStrategyRecord;
      spec: GeneratedStrategySpec;
      /** Only ever set by the sandboxed-code chat wizard's bounded backtest loop (plan §4/§5) — the DSL path never backtests. */
      backtest?: QuantBacktestResult;
      /**
       * True when the backtest cleared the quality gate and the strategy was
       * therefore activated for its owner without a second click. The card
       * reads this so it opens in the state the strategy is actually in,
       * rather than offering to enable something already running.
       */
      autoActivated?: boolean;
    }
  | {
      status: "persisted";
      mode: "sandboxed_code";
      strategy: GeneratedQuantStrategyRecord;
      code: string;
      /**
       * Set once the bounded backtest quality-gate loop
       * (`generateAndBacktestQuantStrategyCodeFromDescription`) ran — always
       * the LAST attempted round's real metrics, whether it passed or not.
       * `undefined` for the (unmodified) direct `generate_strategy` pipeline,
       * which does not backtest this round.
       */
      backtest?: QuantBacktestResult;
      /**
       * True when the backtest cleared the quality gate and the strategy was
       * therefore activated for its owner without a second click.
       */
      autoActivated?: boolean;
    }
  | { status: "invalid"; errors: GenerateValidateQuantStrategyError[] };

export interface QuantAgentChatTurnResult {
  chatId: string;
  intent: QuantAgentChatIntent;
  reply: string;
  memoryCandidate: QuantAgentMemoryCandidate | null;
  strategyProposal: QuantAgentStrategyProposal | null;
  recommendations: QuantRecommendation[];
  usedSkills: QuantAgentUsedSkill[];
  /** Set only while a guided `generate_strategy` wizard turn is in progress. */
  composerCoach: ComposerCoach | null;
}
