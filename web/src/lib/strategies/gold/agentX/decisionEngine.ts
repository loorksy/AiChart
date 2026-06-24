/**
 * Gold Agent X — decision engine (triple gate).
 */
import type { GoldAgentXConfig } from "../goldTypes";
import type {
  CouncilResult,
  DangerAssessment,
  DecisionResult,
  SetupMatch,
} from "./types";
import { clampScore } from "./types";

export interface DecisionInput {
  council: CouncilResult;
  tradeQuality: number;
  tradeScore: number;
  config: GoldAgentXConfig;
  effectiveMinConfidence: number;
  danger: DangerAssessment;
  hasPosition: boolean;
  positionSide?: "buy" | "sell";
  setupMatch?: SetupMatch | null;
  survivalBlocked?: boolean;
}

export function makeDecision(input: DecisionInput): DecisionResult {
  let confidence = input.council.confidence;
  if (input.setupMatch && input.setupMatch.confidenceBoost > 0) {
    confidence = clampScore(confidence + input.setupMatch.confidenceBoost);
  }

  const threshold = Math.max(
    input.config.minConfidence,
    input.effectiveMinConfidence,
    input.danger.confidenceBoost + input.config.minConfidence,
  );

  if (input.hasPosition && input.positionSide) {
    if (input.council.consensusSide !== "hold") {
      const opp =
        (input.positionSide === "buy" && input.council.consensusSide === "sell") ||
        (input.positionSide === "sell" && input.council.consensusSide === "buy");
      if (opp && confidence >= threshold + 10) {
        return {
          action: "REVERSE",
          side: input.council.consensusSide as "buy" | "sell",
          confidence,
          tradeQuality: input.tradeQuality,
          tradeScore: input.tradeScore,
          reason: "انعكاس قوي من المجلس",
        };
      }
    }
    if (confidence < 40 && input.tradeQuality < 50) {
      return {
        action: "CLOSE",
        confidence,
        tradeQuality: input.tradeQuality,
        tradeScore: input.tradeScore,
        reason: "ضعف الزخم — إغلاق",
      };
    }
    return {
      action: "HOLD",
      confidence,
      tradeQuality: input.tradeQuality,
      tradeScore: input.tradeScore,
      reason: "مراقبة الصفقة",
    };
  }

  if (input.danger.level === "EXTREME_DANGER" || !input.danger.allowEntry) {
    return {
      action: "HOLD",
      confidence,
      tradeQuality: input.tradeQuality,
      tradeScore: input.tradeScore,
      reason: input.danger.reason,
      blocked: true,
      blockReason: "danger",
    };
  }

  if (input.survivalBlocked) {
    return {
      action: "HOLD",
      confidence,
      tradeQuality: input.tradeQuality,
      tradeScore: input.tradeScore,
      reason: "وضع البقاء — تداول محدود",
      blocked: true,
      blockReason: "survival",
    };
  }

  const minScore = input.danger.minTradeScoreOverride ?? 60;

  if (
    confidence < threshold ||
    input.tradeQuality < 60 ||
    input.tradeScore < minScore
  ) {
    return {
      action: "HOLD",
      confidence,
      tradeQuality: input.tradeQuality,
      tradeScore: input.tradeScore,
      reason: `بوابة: conf=${confidence} qual=${input.tradeQuality} score=${input.tradeScore}`,
      blocked: true,
      blockReason: "triple_gate",
    };
  }

  if (input.council.consensusSide === "hold") {
    return {
      action: "HOLD",
      confidence,
      tradeQuality: input.tradeQuality,
      tradeScore: input.tradeScore,
      reason: "إجماع HOLD",
    };
  }

  return {
    action: input.council.consensusSide === "buy" ? "BUY" : "SELL",
    side: input.council.consensusSide as "buy" | "sell",
    confidence,
    tradeQuality: input.tradeQuality,
    tradeScore: input.tradeScore,
    reason: `دخول — conf=${confidence} Q=${input.tradeQuality} S=${input.tradeScore}`,
  };
}
