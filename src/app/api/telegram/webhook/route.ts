import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { dispatchTelegramUpdate } from "@/lib/channels/telegram/adapter";

export const runtime = "nodejs";
export const maxDuration = 300;

const log = createLogger("api.telegram.webhook");

/**
 * The inbound half of the Telegram surface — a thin door in front of the
 * channel adapter.
 *
 * Everything here is shaped by one fact about Telegram: it redelivers an update
 * until it receives a 200, on its own schedule. So:
 *
 *  - **Every path answers 200.** A rejected update, a failed analysis, an
 *    unparseable body — all acknowledged. A 500 does not surface the error to
 *    anyone; it just asks Telegram to send the same broken update again, and
 *    again.
 *  - **The secret token is verified before anything else.** The webhook URL is
 *    guessable and this endpoint feeds the whole decision engine; without the
 *    header check, anyone could spend the platform's model budget by POSTing to
 *    it. Telegram sends the token it was registered with in
 *    `X-Telegram-Bot-Api-Secret-Token`.
 *  - **The adapter dedupes before work starts** (Telegram retries mid-flight),
 *    answers channel mechanics itself, and publishes agent turns as resident
 *    `user_message` events — the resident host runs the analysis and replies
 *    through the channel sender, so a long turn never races the retry clock.
 *
 * The unauthorized case is the one exception to answering 200: a caller who
 * failed the secret check is not Telegram, so there is no retry loop to avoid
 * and no reason to pretend the request was accepted.
 */
export async function POST(req: NextRequest) {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!expected) {
    log.warn("telegram.webhook.unconfigured");
    return NextResponse.json(
      { ok: false, error: "webhook secret is not configured" },
      { status: 503 },
    );
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // Malformed JSON is not something a retry fixes.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const outcome = await dispatchTelegramUpdate(body);
  log.info("telegram.webhook.handled", {
    kind: outcome.kind,
    detail:
      outcome.kind === "ignored"
        ? outcome.reason
        : outcome.kind === "handled"
          ? outcome.action
          : "user_message_queued",
  });
  if (outcome.kind === "ignored") {
    return NextResponse.json({ ok: true, ignored: outcome.reason });
  }
  return NextResponse.json({
    ok: true,
    outcome: outcome.kind === "agent" ? "queued" : outcome.action,
  });
}
