import { initDb } from "../src/lib/db";
import { getPlatformValueAsync } from "../src/lib/platformConfig";

async function main() {
  await initDb();
  
  const openaiKey = await getPlatformValueAsync("OPENAI_API_KEY");
  const openrouterKey = await getPlatformValueAsync("OPENROUTER_API_KEY");
  const geminiKey = await getPlatformValueAsync("GEMINI_API_KEY");
  const anthropicKey = await getPlatformValueAsync("ANTHROPIC_API_KEY");

  console.log("=== API Keys Status ===");
  
  if (openaiKey) {
    console.log(`OPENAI_API_KEY: length=${openaiKey.length}, start=${openaiKey.slice(0, 10)}...${openaiKey.slice(-5)}`);
  } else {
    console.log("OPENAI_API_KEY: NOT SET");
  }

  if (openrouterKey) {
    console.log(`OPENROUTER_API_KEY: length=${openrouterKey.length}, start=${openrouterKey.slice(0, 10)}...${openrouterKey.slice(-5)}`);
  } else {
    console.log("OPENROUTER_API_KEY: NOT SET");
  }

  if (geminiKey) {
    console.log(`GEMINI_API_KEY: length=${geminiKey.length}, start=${geminiKey.slice(0, 10)}...${geminiKey.slice(-5)}`);
  } else {
    console.log("GEMINI_API_KEY: NOT SET");
  }

  if (anthropicKey) {
    console.log(`ANTHROPIC_API_KEY: length=${anthropicKey.length}, start=${anthropicKey.slice(0, 10)}...${anthropicKey.slice(-5)}`);
  } else {
    console.log("ANTHROPIC_API_KEY: NOT SET");
  }

  // If OPENAI_API_KEY is set, let's query the models
  if (openaiKey) {
    try {
      console.log("\n--- Testing OPENAI_API_KEY against api.openai.com/v1/models ---");
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${openaiKey}` }
      });
      console.log("Status Code:", res.status);
      if (res.ok) {
        const data = await res.json() as { data?: { id: string }[] };
        const modelIds = (data.data ?? []).map(m => m.id);
        console.log("Available Models (first 15):", modelIds.slice(0, 15));
      } else {
        const text = await res.text();
        console.error("Error Response:", text);
      }
    } catch (e: any) {
      console.error("Request Failed:", e.message);
    }
  }
}

process.env.DATABASE_URL = "postgresql://aichart:589e6a3c7f11cbe0b1ec6cd9c79be93849f178bad04fcd56@127.0.0.1:5432/aichart";
main().catch(console.error);
