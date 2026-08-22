/**
 * The worker side of a queued web turn (Work B, design A2).
 *
 * The route already authenticated, gated billing, claimed the trial slot,
 * and published the event; this consumer runs the SAME turn pipeline the
 * inline path runs (runWebChatTurn) with every emitted event XADDed to the
 * per-turn stream the route relays. Which is exactly what moves usage
 * metering and the balance commit into the worker — with unchanged
 * idempotent keys: the debit ref is still `chat:<turnId>` and the ledger's
 * UNIQUE (user_id, kind, ref) stays the guarantee.
 *
 * Hard rules owned here:
 *  - XAUTOCLAIM redelivery: if the turn stream already holds a terminal
 *    entry (`final` or the end marker), the turn does NOT rerun — a rerun
 *    is a duplicate answer and a second model bill for the same question.
 *  - Cancellation is the explicit flag only (polled → AbortController);
 *    a dead relay never cancels a run.
 *  - The burst guard moved here from the route: one running turn per user
 *    (short queue wait), one WAITING turn per user (instant honest refusal
 *    beyond that) — the queue absorbs bursts instead of a 429.
 */
import { acquireAnalyzeSlot } from "@/lib/analyzeGuard";
import { buildAgentFallbackResult } from "@/lib/agent/fallback";
import { userMessageForFailure, type AgentFailureCode } from "@/lib/agent/errorTaxonomy";
import { stripInternalFieldsFromClientResult } from "@/lib/agent/userSafeOutbound";
import {
  runWebChatTurn,
  webChatBodySchema,
  type WebChatBody,
  type WebTurnDeps,
} from "@/lib/agent/webTurn";
import { releaseTrialInteraction } from "@/lib/subscription/trialQuota";
import { queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import type { PublicUser } from "@/lib/types";
import type { UserMessageEvent } from "./events";
import {
  createTurnStreamClient,
  hasTurnTerminal,
  isTurnCancelRequested,
  TurnStreamWriter,
  type TurnStreamClient,
} from "./turnStream";

const log = createLogger("resident.webturn");

export type QueuedWebTurnOutcome =
  | "completed"
  | "cancelled"
  | "skipped_terminal"
  | "refused_busy"
  | "refused_access"
  | "failed";

export interface QueuedWebTurnDeps {
  /** Injectable stream client (tests). Production creates its own. */
  client?: TurnStreamClient;
  /** Injectable turn runner / agent seams (tests). */
  runTurn?: typeof runWebChatTurn;
  turnDeps?: WebTurnDeps;
  /** How long a turn may wait for the per-user slot before refusing. */
  slotWaitMs?: number;
  /** Cancel-flag poll cadence. */
  cancelPollMs?: number;
}

/** Users with a turn already WAITING for their slot — beyond one, refuse fast. */
const waitingUsers = new Set<number>();

export async function runQueuedWebTurn(
  event: UserMessageEvent,
  deps: QueuedWebTurnDeps = {},
): Promise<QueuedWebTurnOutcome> {
  const web = event.web;
  if (!web) throw new Error("runQueuedWebTurn requires event.web");
  const turnId = web.turnId;
  const locale = web.locale ?? "ar";
  const sessionId = event.channel.id;
  const trialMetered = web.trialMetered ?? false;

  const client = deps.client ?? (await createTurnStreamClient());
  const ownClient = !deps.client;
  let slotRelease: (() => void) | null = null;
  let cancelPoll: NodeJS.Timeout | null = null;
  try {
    // The redelivery guard (mandated): a reclaimed entry whose turn already
    // ended must never rerun. The check is the stream itself — "does the
    // turn stream hold a final?" — not process memory.
    if (await hasTurnTerminal(client, turnId)) {
      log.info("queued web turn already terminal — skipping rerun", { turnId });
      return "skipped_terminal";
    }

    const writer = new TurnStreamWriter(client, turnId);
    await writer.open(event.userId);
    const emit = (eventName: string, data: unknown) => {
      // XADDs on one connection keep call order; a lost write is logged,
      // never thrown into the run (the answer still persists to history).
      void writer.append(eventName, data).catch((err) =>
        log.warn("turn stream append failed", {
          turnId,
          event: eventName,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    };

    const refuse = async (code: AgentFailureCode): Promise<void> => {
      if (trialMetered) await releaseTrialInteraction(event.userId, turnId);
      const fallback = buildAgentFallbackResult(
        `Queued web turn refused before start (${code}).`,
        [],
        locale,
        { retryable: code === "resource_exhausted", failureStage: "transport", failureCode: code, traceId: turnId },
      );
      const safe = stripInternalFieldsFromClientResult(fallback);
      emit("final", {
        ...safe,
        sessionId,
        activityEvents: [],
        stages: [],
        options: [],
        suggestions: [],
      });
      emit("error", {
        error: userMessageForFailure(code, locale),
        code,
        trace_id: turnId,
      });
      await writer.end("failed");
    };

    // The route resolved the user at enqueue; re-read at run time so a
    // block landing between the two still refuses server-side.
    const user = await queryOne<Pick<PublicUser, "id" | "role" | "status">>(
      "SELECT id, role, status FROM users WHERE id = ?",
      [event.userId],
    );
    if (!user || user.status !== "active") {
      await refuse("auth");
      return "refused_access";
    }

    // Per-user burst guard, queue-shaped: the running turn's successor waits
    // for the slot; anything beyond that refuses immediately and honestly.
    if (waitingUsers.has(event.userId)) {
      await refuse("resource_exhausted");
      return "refused_busy";
    }
    waitingUsers.add(event.userId);
    try {
      slotRelease = await waitForAnalyzeSlot(event.userId, deps.slotWaitMs ?? 90_000);
    } finally {
      waitingUsers.delete(event.userId);
    }
    if (!slotRelease) {
      await refuse("resource_exhausted");
      return "refused_busy";
    }

    // Explicit-cancel wiring: the flag key → this controller → the run's
    // signal. Nothing else aborts a queued turn.
    const controller = new AbortController();
    cancelPoll = setInterval(() => {
      void isTurnCancelRequested(client, turnId)
        .then((cancelled) => {
          if (cancelled) controller.abort();
        })
        .catch(() => {});
    }, deps.cancelPollMs ?? 1_000);
    cancelPoll.unref?.();
    if (await isTurnCancelRequested(client, turnId).catch(() => false)) {
      controller.abort();
    }
    if (controller.signal.aborted) {
      if (trialMetered) await releaseTrialInteraction(event.userId, turnId);
      await writer.end("cancelled");
      return "cancelled";
    }

    const body = rebuildBody(event, web.chartContext, locale);
    const outcome = await (deps.runTurn ?? runWebChatTurn)(
      {
        user,
        body,
        requestId: turnId,
        sessionId,
        trialMetered,
        modelRef: web.modelRef ?? null,
        signal: controller.signal,
        emit,
      },
      deps.turnDeps ?? {},
    );

    await writer.end(
      outcome.aborted ? "cancelled" : outcome.sentFinal ? "final" : "failed",
    );
    return outcome.aborted ? "cancelled" : "completed";
  } catch (err) {
    // Never rethrow after work may have run: a bus retry would re-run a
    // whole model turn. Crash redelivery is XAUTOCLAIM's job, and the
    // terminal guard above is its safety.
    log.error("queued web turn failed", {
      turnId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await new TurnStreamWriter(client, turnId).end("failed");
    } catch {
      /* stream unreachable — the client falls back to history recovery */
    }
    return "failed";
  } finally {
    if (cancelPoll) clearInterval(cancelPoll);
    slotRelease?.();
    if (ownClient) await client.quit().catch(() => {});
  }
}

/** The event's payload back into the route's bounded body shape. */
function rebuildBody(
  event: UserMessageEvent,
  chartContext: unknown,
  locale: "ar" | "en",
): WebChatBody {
  const parsed = webChatBodySchema.safeParse({
    message: event.text,
    sessionId: event.channel.id,
    chartContext,
    locale,
  });
  if (parsed.success) return parsed.data;
  // A context that no longer validates degrades to a context-less turn —
  // never a dropped one. The message itself already passed the event schema.
  log.warn("queued web turn chart context rejected", {
    turnId: event.web?.turnId,
    issue: parsed.error.issues[0]?.message,
  });
  return { message: event.text, sessionId: event.channel.id, locale };
}

async function waitForAnalyzeSlot(
  userId: number,
  timeoutMs: number,
): Promise<(() => void) | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const slot = acquireAnalyzeSlot(userId);
    if (slot.ok) return slot.release;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}
