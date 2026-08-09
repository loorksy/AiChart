/**
 * Build a safe user-drawing deletion command — NO LLM, NO trade analysis.
 * Deletes ONLY user-owned drawings, only by resolved stable id. A singular
 * command removes exactly one drawing; wiping all user drawings requires
 * explicit "all" wording. Agent/recommendation drawings are never touched here.
 */
import type {
  SerializedChartDrawing,
  UserDrawingMutationCommand,
} from "@/lib/chart/drawings/types";
import { userDrawings } from "@/lib/chart/drawings/drawingOwnership";

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `mut-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

/** True when the message explicitly asks to delete ALL user drawings. */
export function wantsDeleteAll(message: string): boolean {
  const t = message.toLowerCase();
  return /all (my )?drawings|every drawing|كل رسوماتي|جميع رسوماتي|كل الرسومات|امسح رسوماتي كلها|احذف رسوماتي كلها/.test(
    t,
  );
}

export type DeleteResult =
  | { ok: true; commands: UserDrawingMutationCommand[] }
  | { ok: false; reason: "wrong_owner" | "not_user" };

/** Delete a single, already-resolved user drawing by id. */
export function buildDeleteUserDrawing(input: {
  drawing: SerializedChartDrawing;
  mutationId?: string;
}): DeleteResult {
  if (input.drawing.owner !== "user") return { ok: false, reason: "wrong_owner" };
  return {
    ok: true,
    commands: [
      {
        mutationId: input.mutationId ?? uuid(),
        mutation: { type: "delete", drawingId: input.drawing.id },
      },
    ],
  };
}

/** Delete every USER-owned drawing (only when the user explicitly said "all"). */
export function buildDeleteAllUserDrawings(input: {
  drawings: SerializedChartDrawing[];
}): DeleteResult {
  const users = userDrawings(input.drawings);
  return {
    ok: true,
    commands: users.map((d) => ({
      mutationId: uuid(),
      mutation: { type: "delete" as const, drawingId: d.id },
    })),
  };
}
