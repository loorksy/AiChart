import { NextRequest, NextResponse } from "next/server";
import { initDb, queryOne } from "@/lib/db";
import { getSettings } from "@/lib/store";
import { loadChatMessages, messagesToAgentHistory } from "@/lib/conversations";
import { runAgent } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await initDb();

    // Find the last chat message that has an image
    const lastImgMsg = await queryOne<{ conversation_id: number }>(
      "SELECT conversation_id FROM chat_messages WHERE role = 'user' AND metadata_json LIKE '%image%' ORDER BY id DESC LIMIT 1"
    );

    if (!lastImgMsg) {
      return NextResponse.json({ error: "No conversation with image found in database." });
    }

    const conversationId = lastImgMsg.conversation_id;
    
    const conv = await queryOne<{ user_id: number }>(
      "SELECT user_id FROM conversations WHERE id = ?",
      [conversationId]
    );

    if (!conv) {
      return NextResponse.json({ error: `Conversation ${conversationId} not found.` });
    }

    const userId = conv.user_id;
    const settings = await getSettings(userId);
    const persisted = await loadChatMessages(conversationId);
    const history = messagesToAgentHistory(persisted);

    const start = Date.now();
    const result = await runAgent(
      { userId, settings },
      history,
      { responseMode: "vision" }
    );

    return NextResponse.json({
      ok: true,
      timeMs: Date.now() - start,
      conversationId,
      userId,
      historyLength: history.length,
      reply: result.reply,
      recommendations: result.recommendations,
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message || String(err),
      stack: err.stack,
    }, { status: 500 });
  }
}
