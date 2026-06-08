import { runAgent } from "../src/lib/agent";
import { getSettings } from "../src/lib/store";

const userId = 1;

async function main() {
  const settings = await getSettings(userId);
  console.log("running agent...");
  const start = Date.now();
  try {
    const result = await runAgent(
      { userId, settings },
      [{ role: "user", content: "ما رأيك في BTCUSDT الآن؟" }],
    );
    console.log("done in", Date.now() - start, "ms");
    console.log("reply:", result.reply.slice(0, 200));
    console.log("recs:", result.recommendations.length);
  } catch (e) {
    console.error("FAILED in", Date.now() - start, "ms:", e instanceof Error ? e.message : e);
  }
}

void main();
