import { NextRequest, NextResponse } from "next/server";
import { runCopilot } from "@/lib/copilot";
import { createConversation } from "@/lib/conversations";
import { execute, query } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const logs: string[] = [];
    const log = (...args: any[]) => {
      const msg = args.join(" ");
      console.log("[test-copilot]", msg);
      logs.push(msg);
    };

    log("=== Testing 3 Phases ===");
    const userId = 1;

    // 1. Create fresh conversation
    log("1. Creating fresh conversation...");
    const conv = await createConversation(userId, "Test Session " + new Date().toISOString());
    const conversationId = conv.id;
    log("Conversation ID:", conversationId);

    // 2. Step 1: Request trade without params
    log("2. Sending: 'أريد فتح صفقة شراء على BTC'");
    const result1 = await runCopilot(userId, conversationId, "أريد فتح صفقة شراء على BTC", []);
    log("Reply:", result1.reply);
    log("Question payload:", JSON.stringify(result1.question));

    if (result1.question?.type === "timeframe") {
      log("=> PASS: Timeframe selection request received!");
    } else {
      log("=> FAIL: Expected timeframe question.");
    }

    // 3. Step 2: Answer timeframe
    log("3. Replying with timeframe: '1h'");
    await execute(
      "UPDATE conversations SET workflow_state = ?, workflow_context = ? WHERE id = ?",
      ["awaiting_timeframe_selection", JSON.stringify({ initial_request: "أريد فتح صفقة شراء على BTC" }), conversationId]
    );

    const result2 = await runCopilot(userId, conversationId, "1h", []);
    log("Reply:", result2.reply);
    log("Question payload:", JSON.stringify(result2.question));

    if (result2.question?.type === "trading_style") {
      log("=> PASS: Strategy selection request received!");
    } else {
      log("=> FAIL: Expected strategy style question.");
    }

    // 4. Step 3: Answer strategy
    log("4. Replying with strategy: 'scalp'");
    await execute(
      "UPDATE conversations SET workflow_state = ?, workflow_context = ? WHERE id = ?",
      ["awaiting_strategy_selection", JSON.stringify({ initial_request: "أريد فتح صفقة شراء على BTC", timeframe: "1h" }), conversationId]
    );

    const result3 = await runCopilot(userId, conversationId, "scalp", []);
    log("Reply:", result3.reply);
    log("Recommendations count:", result3.recommendations?.length);

    // Verify event logs in copilot_events
    log("5. Checking copilot_events log in DB...");
    const events = await query<{ event_type: string }>(
      "SELECT event_type FROM copilot_events WHERE conversation_id = ? ORDER BY id ASC",
      [conversationId]
    );
    log("Logged Events count:", events.length);
    events.forEach((e) => log(`  - ${e.event_type}`));

    if (events.length > 0) {
      log("=> PASS: Copilot events logged successfully!");
    } else {
      log("=> FAIL: No events logged.");
    }

    // Clean up
    log("6. Cleaning up test conversation...");
    await execute("DELETE FROM conversations WHERE id = ?", [conversationId]);
    log("Test finished successfully.");

    return NextResponse.json({ success: true, logs });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || err });
  }
}
