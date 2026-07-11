/**
 * A safe, serialized representation of a chart drawing that can cross the
 * client→server boundary. This NEVER carries raw TradingView internals — only
 * plain, bounded data the agent can reason about and mutate by id.
 */
export type DrawingOwner = "user" | "agent" | "recommendation";

export type SerializedDrawingPoint = {
  time?: number;
  price?: number;
};

export type SerializedChartDrawing = {
  id: string;
  owner: DrawingOwner;
  type: string;

  symbol: string;
  interval: string;

  points: SerializedDrawingPoint[];
  priceLevels?: number[];

  label?: string;
  color?: string;
  lineStyle?: string;

  visible?: boolean;
  locked?: boolean;

  createdAt?: number;
  updatedAt?: number;

  source: "tradingview" | "lonora";
};

/** A structured, id-scoped mutation the client applies after the final SSE. */
export type UserDrawingMutation =
  | { type: "move_level"; drawingId: string; price: number }
  | {
      type: "move_point";
      drawingId: string;
      pointIndex: number;
      point: SerializedDrawingPoint;
    }
  | { type: "replace_points"; drawingId: string; points: SerializedDrawingPoint[] }
  | { type: "resize_zone"; drawingId: string; upperPrice: number; lowerPrice: number }
  | { type: "update_label"; drawingId: string; label: string }
  | { type: "delete"; drawingId: string };

/** A mutation wrapped with an idempotency key so it applies exactly once. */
export interface UserDrawingMutationCommand {
  mutationId: string;
  mutation: UserDrawingMutation;
}

export const DRAWING_LIMITS = {
  maxDrawings: 50,
  maxPoints: 8,
  maxLabel: 200,
} as const;
