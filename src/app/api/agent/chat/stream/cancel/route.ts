import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requirePlatformAccess } from "@/lib/api";
import {
  createTurnStreamClient,
  requestTurnCancel,
  turnOwner,
  turnQueueEnabled,
} from "@/lib/resident/turnStream";

export const runtime = "nodejs";

const schema = z.object({ turnId: z.string().min(1).max(64) });

/**
 * The explicit cancel (approved decision 1): closing the tab never cancels a
 * queued turn — the run completes and the answer waits in history. ONLY this
 * endpoint, wired to the cancel button, cancels: it flags the turn and the
 * worker's poller fires its AbortController. Inline (no REDIS_URL) runs are
 * cancelled by the fetch abort itself, so this is a no-op there.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const { turnId } = schema.parse(await req.json());
    if (!turnQueueEnabled()) {
      return NextResponse.json({ ok: true, mode: "inline" });
    }
    const client = await createTurnStreamClient();
    try {
      const owner = await turnOwner(client, turnId);
      if (owner !== user.id) {
        return NextResponse.json({ error: "unknown turn" }, { status: 404 });
      }
      await requestTurnCancel(client, turnId);
    } finally {
      await client.quit().catch(() => {});
    }
    return NextResponse.json({ ok: true, mode: "queued" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    return handleError(err);
  }
}
