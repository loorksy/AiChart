/**
 * Handle a user-drawing intent (discuss / modify / move / delete / clarify).
 * This path NEVER runs market, risk, news, or execution agents and NEVER
 * produces a trade recommendation. It only:
 *   - reads the safe serialized user drawings from the chart context,
 *   - resolves which drawing the message refers to (deterministically),
 *   - and returns either an answer, a clarification request, or a set of
 *     idempotent `drawingMutations` the client applies AFTER the final SSE.
 *
 * Safety rules enforced here: only owner === "user" drawings are ever mutated;
 * an ambiguous destructive reference asks for clarification instead of guessing;
 * nothing is silently deleted or overwritten.
 */
import type { AppLocale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { userDrawings } from "@/lib/chart/drawings/drawingOwnership";
import { drawingPriceLevels } from "@/lib/chart/drawings/serializeUserDrawings";
import type {
  SerializedChartDrawing,
  UserDrawingMutationCommand,
} from "@/lib/chart/drawings/types";
import type { AgentChartContext, AgentFinalResult, AgentIntent } from "../types";
import { contextualOptionsFor } from "../contextualOptions";
import { resolveUserDrawingReference } from "./resolveUserDrawingReference";
import { discussUserDrawing } from "./discussUserDrawing";
import { buildUserDrawingMutation } from "./modifyUserDrawing";
import {
  buildDeleteAllUserDrawings,
  buildDeleteUserDrawing,
  wantsDeleteAll,
} from "./deleteUserDrawing";

function informational(
  summary: string,
  locale: AppLocale,
  extra?: Partial<AgentFinalResult>,
): AgentFinalResult {
  return {
    decision: "informational",
    confidence: 0.85,
    summary,
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
    options: contextualOptionsFor({ decision: "informational", locale }),
    ...extra,
  };
}

/** Short label for a candidate in an ambiguity prompt (type + price). */
function candidateLabel(d: SerializedChartDrawing, locale: AppLocale): string {
  const levels = drawingPriceLevels(d);
  const priceText = levels.length
    ? levels.length >= 2
      ? `${Math.min(...levels)}–${Math.max(...levels)}`
      : `${levels[0]}`
    : "—";
  const name = d.label ?? d.type;
  return locale === "en" ? `${name} (${priceText})` : `${name} (${priceText})`;
}

function ambiguousList(
  candidates: SerializedChartDrawing[],
  locale: AppLocale,
): string {
  return candidates
    .slice(0, 5)
    .map((d, i) => `${i + 1}. ${candidateLabel(d, locale)}`)
    .join("  ");
}

function whichLabel(d: SerializedChartDrawing, locale: AppLocale, selectedId?: string): string {
  if (selectedId && d.id === selectedId) return t(locale, "drawing.selected");
  return t(locale, "drawing.user_drawing");
}

export interface HandleUserDrawingInput {
  intents: AgentIntent[];
  userMessage: string;
  chartContext?: AgentChartContext;
  locale?: AppLocale;
}

export async function handleUserDrawingCommand(
  input: HandleUserDrawingInput,
): Promise<AgentFinalResult> {
  const locale: AppLocale = input.locale ?? "ar";
  const drawings = input.chartContext?.userDrawings ?? [];
  const selectedId = input.chartContext?.selectedDrawingId;
  const currentPrice = input.chartContext?.latestCandle?.close ?? null;
  const users = userDrawings(drawings);

  // No user drawings exist at all → never guess, never touch agent drawings.
  if (users.length === 0) {
    return informational(t(locale, "drawing.none_found"), locale);
  }

  const isDelete = input.intents.includes("delete_user_drawing");
  const isMove = input.intents.includes("move_user_drawing");
  const isModify = input.intents.includes("modify_user_drawing");
  const isClarify = input.intents.includes("clarify_drawing_reference");

  // Pure clarification request.
  if (isClarify) {
    return informational(t(locale, "drawing.clarify"), locale);
  }

  // "Delete all my drawings" — explicit wording only; user-owned only.
  if (isDelete && wantsDeleteAll(input.userMessage)) {
    const del = buildDeleteAllUserDrawings({ drawings: users });
    const commands = del.ok ? del.commands : [];
    return informational(
      t(locale, "drawing.deleted_all", { count: String(commands.length) }),
      locale,
      { drawingMutations: commands },
    );
  }

  // Destructive/mutating commands must resolve to a strong, unambiguous target.
  const requireStrong = isDelete || isMove || isModify;
  const resolution = resolveUserDrawingReference({
    message: input.userMessage,
    drawings: users,
    selectedDrawingId: selectedId,
    requireStrong,
    // For move/modify a mentioned price is the destination, not a selector.
    ignorePriceSignal: isMove || isModify,
  });

  if (resolution.kind === "none") {
    return informational(t(locale, "drawing.not_found"), locale);
  }
  if (resolution.kind === "ambiguous") {
    return informational(
      t(locale, "drawing.ambiguous", { list: ambiguousList(resolution.candidates, locale) }),
      locale,
    );
  }

  const drawing = resolution.drawing;
  const which = whichLabel(drawing, locale, selectedId);

  // Delete a single, resolved user drawing.
  if (isDelete) {
    const del = buildDeleteUserDrawing({ drawing });
    if (!del.ok) {
      return informational(t(locale, "drawing.wrong_owner"), locale);
    }
    return informational(t(locale, "drawing.deleted", { which }), locale, {
      drawingMutations: del.commands,
    });
  }

  // Move / modify → build one validated mutation.
  if (isMove || isModify) {
    const built = buildUserDrawingMutation({
      message: input.userMessage,
      drawing,
      contextSymbol: input.chartContext?.symbol,
    });
    if (!built.ok) return informational(mutationFailureMessage(built.reason, which, locale), locale);

    const commands: UserDrawingMutationCommand[] = [built.command];
    const mutation = built.command.mutation;
    if (mutation.type === "move_level") {
      return informational(
        t(locale, "drawing.moved", { which, price: String(mutation.price) }),
        locale,
        { drawingMutations: commands },
      );
    }
    return informational(t(locale, "drawing.updated", { which }), locale, {
      drawingMutations: commands,
    });
  }

  // Default: discuss the resolved drawing (no mutation, no trade).
  const summary = await discussUserDrawing({
    userMessage: input.userMessage,
    drawing,
    currentPrice,
    locale,
  });
  return informational(summary, locale);
}

function mutationFailureMessage(
  reason: "wrong_owner" | "wrong_symbol" | "invalid_price" | "unsupported" | "no_change",
  which: string,
  locale: AppLocale,
): string {
  switch (reason) {
    case "wrong_owner":
      return t(locale, "drawing.wrong_owner");
    case "wrong_symbol":
      return t(locale, "drawing.wrong_symbol");
    case "invalid_price":
      return t(locale, "drawing.invalid_price");
    default:
      return t(locale, "drawing.cannot_modify", { which });
  }
}
