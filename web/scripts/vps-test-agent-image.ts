import { initDb, queryOne } from "../src/lib/db";
import { getSettings } from "../src/lib/store";
import { loadChatMessages, messagesToAgentHistory } from "../src/lib/conversations";
import { runAgent } from "../src/lib/agent";

async function main() {
  await initDb();
  
  // Find the last chat message that has an image
  const lastImgMsg = await queryOne<{ conversation_id: number }>(
    "SELECT conversation_id FROM chat_messages WHERE role = 'user' AND metadata_json LIKE '%image%' ORDER BY id DESC LIMIT 1"
  );
  
  if (!lastImgMsg) {
    console.error("No conversation with image found.");
    return;
  }
  
  const conversationId = lastImgMsg.conversation_id;
  console.log("Testing with Conversation ID:", conversationId);
  
  // Find the user ID of this conversation
  const conv = await queryOne<{ user_id: number }>(
    "SELECT user_id FROM conversations WHERE id = ?",
    [conversationId]
  );
  
  if (!conv) {
    console.error("Conversation not found.");
    return;
  }
  
  const userId = conv.user_id;
  console.log("User ID:", userId);
  
  const settings = await getSettings(userId);
  const persisted = await loadChatMessages(conversationId);
  const history = messagesToAgentHistory(persisted);
  
  console.log("Loaded history length:", history.length);
  const lastMsg = history[history.length - 1];
  console.log("Last message content structure:", typeof lastMsg.content === "string" ? "string" : `array of length ${lastMsg.content.length}`);
  if (Array.isArray(lastMsg.content)) {
    console.log("Blocks in last message:");
    for (const block of lastMsg.content) {
      console.log(`- type: ${block.type}, keys: ${Object.keys(block)}`);
      if (block.type === "image") {
        console.log(`  media_type: ${block.source.media_type}, data length: ${block.source.data.length}`);
      }
    }
  }

  console.log("\nRunning Agent...");
  const start = Date.now();
  try {
    const result = await runAgent(
      { userId, settings },
      history,
      { responseMode: "vision" } // Force vision mode to check
    );
    console.log(`\nDone in ${Date.now() - start} ms`);
    console.log("=== Agent Reply ===");
    console.log(result.reply);
    console.log("===================");
    console.log("Recommendations count:", result.recommendations.length);
  } catch (e: any) {
    console.error("Agent run failed:", e.message || e);
  }
}

process.env.DATABASE_URL = "postgresql://aichart:589e6a3c7f11cbe0b1ec6cd9c79be93849f178bad04fcd56@127.0.0.1:5432/aichart";
main().catch(console.error);
