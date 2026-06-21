import { runCopilot } from "../src/lib/copilot";
import { createConversation } from "../src/lib/conversations";
import { execute } from "../src/lib/db";

async function runTest() {
  console.log("=== Testing 3 Phases on VPS ===");
  const userId = 1; // Assuming user ID 1 exists
  
  // 1. Create a fresh conversation for test
  console.log("1. Creating fresh conversation...");
  const conv = await createConversation(userId, "Test Session " + new Date().toISOString());
  const conversationId = conv.id;
  console.log("Conversation ID:", conversationId);

  // 2. Test Step 1: Request trade without parameters
  console.log("\n2. Sending request: 'أريد فتح صفقة شراء على BTC'");
  let history: any[] = [];
  let result1 = await runCopilot(userId, conversationId, "أريد فتح صفقة شراء على BTC", history);
  console.log("Reply:", result1.reply);
  console.log("Question payload:", JSON.stringify(result1.question, null, 2));

  // Verify parameter gating (Phase 2)
  if (result1.question?.type === "timeframe") {
    console.log("=> PASS: Timeframe selection request received!");
  } else {
    console.log("=> FAIL: Expected timeframe question.");
  }

  // 3. Test Step 2: Answer timeframe
  console.log("\n3. Replying with timeframe: '1h'");
  // Update DB context simulates what /api/chat does
  await execute(
    "UPDATE conversations SET workflow_state = ?, workflow_context = ? WHERE id = ?",
    ["awaiting_timeframe_selection", JSON.stringify({ initial_request: "أريد فتح صفقة شراء على BTC" }), conversationId]
  );
  
  let result2 = await runCopilot(userId, conversationId, "1h", history);
  console.log("Reply:", result2.reply);
  console.log("Question payload:", JSON.stringify(result2.question, null, 2));

  if (result2.question?.type === "trading_style") {
    console.log("=> PASS: Strategy selection request received!");
  } else {
    console.log("=> FAIL: Expected strategy style question.");
  }

  // 4. Test Step 3: Answer strategy
  console.log("\n4. Replying with strategy: 'scalp'");
  await execute(
    "UPDATE conversations SET workflow_state = ?, workflow_context = ? WHERE id = ?",
    ["awaiting_strategy_selection", JSON.stringify({ initial_request: "أريد فتح صفقة شراء على BTC", timeframe: "1h" }), conversationId]
  );

  let result3 = await runCopilot(userId, conversationId, "scalp", history);
  console.log("Reply:", result3.reply);
  console.log("Recommendations count:", result3.recommendations?.length);

  // Verify event logs in copilot_events (Phase 2)
  console.log("\n5. Checking copilot_events log in DB...");
  const events = (await execute(
    "SELECT event_type, created_at FROM copilot_events WHERE conversation_id = ? ORDER BY id ASC",
    [conversationId]
  )) as unknown as any[];
  console.log("Logged Events:");
  events.forEach(e => console.log(`  - ${e.event_type} (${e.created_at})`));

  if (events.length > 0) {
    console.log("=> PASS: Copilot events logged successfully!");
  } else {
    console.log("=> FAIL: No events logged.");
  }

  // Clean up
  console.log("\n6. Cleaning up test conversation...");
  await execute("DELETE FROM conversations WHERE id = ?", [conversationId]);
  console.log("Test finished.");
}

// Set up postgres env
process.env.DATABASE_URL = "postgresql://aichart:589e6a3c7f11cbe0b1ec6cd9c79be93849f178bad04fcd56@127.0.0.1:5432/aichart";
runTest().catch(console.error);
