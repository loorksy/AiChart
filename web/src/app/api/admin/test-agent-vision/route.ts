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

    if (history.length === 0) {
      return NextResponse.json({ error: "Loaded history is empty." });
    }

    const lastUserMessage = history[history.length - 1];

    console.log("Running test 1: Full History");
    const start1 = Date.now();
    const resultFull = await runAgent(
      { userId, settings },
      history,
      { responseMode: "vision" }
    );
    const timeFull = Date.now() - start1;

    console.log("Running test 2: Single Message (Clean History)");
    const start2 = Date.now();
    const resultSingle = await runAgent(
      { userId, settings },
      [lastUserMessage],
      { responseMode: "vision" }
    );
    const timeSingle = Date.now() - start2;

    return NextResponse.json({
      ok: true,
      conversationId,
      userId,
      historyLength: history.length,
      lastMessageText: typeof lastUserMessage.content === "string" ? lastUserMessage.content : lastUserMessage.content.find(b => b.type === "text")?.text,
      fullHistoryTest: {
        timeMs: timeFull,
        reply: resultFull.reply,
        recommendations: resultFull.recommendations,
      },
      singleMessageTest: {
        timeMs: timeSingle,
        reply: resultSingle.reply,
        recommendations: resultSingle.recommendations,
      }
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message || String(err),
      stack: err.stack,
    }, { status: 500 });
  }
}
