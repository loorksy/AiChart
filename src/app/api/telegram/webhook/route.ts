import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import {
  alreadyHandled,
  handleTelegramMessage,
  parseTelegramUpdate,
} from "@/lib/telegram/webhookAgent";

export const runtime = "nodejs";
export const maxDuration = 300;

const log = createLogger("api.telegram.webhook");

/**
 * The inbound half of the Telegram surface.
 *
 * Everything here is shaped by one fact about Telegram: it redelivers an update
 * until it receives a 200, on its own schedule. So:
 *
 *  - **Every path answers 200.** A rejected update, a failed analysis, an
 *    unparseable body — all acknowledged. A 500 does not surface the error to
 *    anyone; it just asks Telegram to send the same broken update again, and
 *    again.
 *  - **The secret token is verified before anything else.** The webhook URL is
 *    guessable and this endpoint runs the whole decision engine; without the
 *    header check, anyone could spend the platform's model budget by POSTing to
 *    it. Telegram sends the token it was registered with in
 *    `X-Telegram-Bot-Api-Secret-Token`.
 *  - **Updates are deduped before work starts**, because a 40-second analysis
 *    is long enough for Telegram to retry mid-flight, and the second run would
 *    store a second recommendation for one question.
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

  const message = parseTelegramUpdate(body);
  if (!message) return NextResponse.json({ ok: true, ignored: "unsupported_update" });
  if (alreadyHandled(message.updateId)) {
    return NextResponse.json({ ok: true, ignored: "duplicate" });
  }

  const outcome = await handleTelegramMessage(message);
  log.info("telegram.webhook.handled", {
    updateId: message.updateId,
    outcome,
  });
  return NextResponse.json({ ok: true, outcome });
}
