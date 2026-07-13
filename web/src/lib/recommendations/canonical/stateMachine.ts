import {
  RECOMMENDATION_STATUSES,
  RecommendationLifecycleError,
  type RecommendationStatus,
} from "./types";

const TRANSITIONS: Readonly<Record<RecommendationStatus, readonly RecommendationStatus[]>> = {
  draft: ["active", "cancelled", "invalidated"],
  active: ["triggered", "sl_hit", "expired", "cancelled", "invalidated"],
  triggered: [
    "partially_closed",
    "tp_hit",
    "sl_hit",
    "expired",
    "cancelled",
    "invalidated",
    "closed",
  ],
  partially_closed: [
    "tp_hit",
    "sl_hit",
    "expired",
    "cancelled",
    "invalidated",
    "closed",
  ],
  tp_hit: [],
  sl_hit: [],
  expired: [],
  cancelled: [],
  invalidated: [],
  closed: [],
};

export function isRecommendationStatus(value: unknown): value is RecommendationStatus {
  return RECOMMENDATION_STATUSES.includes(value as RecommendationStatus);
}

export function isTerminalRecommendationStatus(status: RecommendationStatus): boolean {
  return ["tp_hit", "sl_hit", "expired", "cancelled", "invalidated", "closed"].includes(
    status,
  );
}

export function canTransitionRecommendation(
  from: RecommendationStatus,
  to: RecommendationStatus,
): boolean {
  return from !== to && TRANSITIONS[from].includes(to);
}

export function assertRecommendationTransition(
  from: RecommendationStatus,
  to: RecommendationStatus,
): void {
  if (!canTransitionRecommendation(from, to)) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_ILLEGAL_TRANSITION",
      `Illegal recommendation transition: ${from} -> ${to}`,
    );
  }
}

export function initialRecommendationStatus(input: {
  direction: "buy" | "sell" | "wait";
  entry?: number | null;
  stopLoss?: number | null;
  targets?: number[];
}): RecommendationStatus {
  return input.direction !== "wait" &&
    input.entry != null &&
    input.stopLoss != null &&
    Boolean(input.targets?.length)
    ? "active"
    : "draft";
}
