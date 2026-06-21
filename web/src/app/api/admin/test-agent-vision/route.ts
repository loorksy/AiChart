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

    // Find the last message that has an image block
    let lastImageMessageIndex = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (Array.isArray(msg.content) && msg.content.some(block => block.type === "image")) {
        lastImageMessageIndex = i;
        break;
      }
    }

    if (lastImageMessageIndex === -1) {
      return NextResponse.json({ error: "Could not find any message with an image in history." });
    }

    const lastImageMessage = history[lastImageMessageIndex];
    
    // Test 1: Full history up to last image message
    const historyUpToImage = history.slice(0, lastImageMessageIndex + 1);

    // Test 3: Collapsed history (removes duplicate consecutive user messages)
    const collapsedHistory: typeof history = [];
    for (let i = 0; i < historyUpToImage.length; i++) {
      const current = historyUpToImage[i];
      const next = historyUpToImage[i + 1];
      
      // If current is user and next is user, skip current (effectively keeping the last one)
      if (current.role === "user" && next && next.role === "user") {
        console.log(`Collapsing consecutive user message at index ${i}`);
        continue;
      }
      collapsedHistory.push(current);
    }

    console.log(`Running Test 1: Full History up to image (length ${historyUpToImage.length})`);
    const start1 = Date.now();
    const resultFull = await runAgent(
      { userId, settings },
      historyUpToImage,
      { responseMode: "vision" }
    );
    const timeFull = Date.now() - start1;

    console.log(`Running Test 3: Collapsed History (length ${collapsedHistory.length})`);
    const start3 = Date.now();
    const resultCollapsed = await runAgent(
      { userId, settings },
      collapsedHistory,
      { responseMode: "vision" }
    );
    const timeCollapsed = Date.now() - start3;

    console.log("Running Test 2: Single Message with Image");
    const start2 = Date.now();
    const resultSingle = await runAgent(
      { userId, settings },
      [lastImageMessage],
      { responseMode: "vision" }
    );
    const timeSingle = Date.now() - start2;

    return NextResponse.json({
      ok: true,
      conversationId,
      userId,
      historyLength: history.length,
      imageMessageIndex: lastImageMessageIndex,
      collapsedHistoryLength: collapsedHistory.length,
      historyUpToImageTest: {
        timeMs: timeFull,
        reply: resultFull.reply,
      },
      collapsedHistoryTest: {
        timeMs: timeCollapsed,
        reply: resultCollapsed.reply,
      },
      singleImageMessageTest: {
        timeMs: timeSingle,
        reply: resultSingle.reply,
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
