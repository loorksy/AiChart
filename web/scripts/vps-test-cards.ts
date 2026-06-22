import { runCopilot } from "../src/lib/copilot";
import { createConversation } from "../src/lib/conversations";
import { execute } from "../src/lib/db";

/** Verifies the agent actually emits an interactive card via render_cards. */
async function main() {
  const userId = 1;
  const prompts = [
    "حلل زوج EURUSD على فريم الساعة",
    "ما الأزواج المتاحة في حسابي؟",
  ];

  for (const prompt of prompts) {
    const conv = await createConversation(userId, "card-test " + prompt.slice(0, 12));
    console.log("\n=== Prompt:", prompt, "(conv", conv.id + ") ===");
    const res = await runCopilot(userId, conv.id, prompt, []);
    const ui: any = (res as any).uiSchema;
    console.log("reply (head):", (res.reply || "").slice(0, 120).replace(/\n/g, " "));
    if (ui && Array.isArray(ui.layout) && ui.layout.length) {
      console.log("=> PASS uiSchema: components =", ui.layout.map((e: any) => e.component).join(", "));
    } else {
      console.log("=> FAIL: no uiSchema (agent did not call render_cards)");
    }
    await execute("DELETE FROM conversations WHERE id = ?", [conv.id]);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
