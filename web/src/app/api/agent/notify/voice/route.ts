import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { synthesizeSpeech } from "@/lib/embeddings";
import { notifyUserVoice } from "@/lib/telegram";

const schema = z.object({
  text: z.string().min(1).max(4000),
  userId: z.number().int().positive().optional(),
  caption: z.string().max(500).optional(),
});

/**
 * Bridge: synthesizes Arabic speech and pushes OGG to the user's Telegram.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const body = schema.parse(await req.json());
    const enabled = await getPlatformValueAsync("VOICE_RESPONSES_ENABLED");
    if (enabled === "0" || enabled === "false") {
      return NextResponse.json(
        { ok: false, error: "الردود الصوتية معطّلة في إعدادات المنصّة." },
        { status: 403 },
      );
    }

    const userId = body.userId ?? (await resolveAgentUserId());
    const audio = await synthesizeSpeech(body.text);
    await notifyUserVoice(userId, audio, body.caption);

    return NextResponse.json({
      ok: true,
      bytes: audio.length,
      userId,
    });
  } catch (e) {
    return handleError(e);
  }
}
