import { callLLM } from "../src/lib/llm";
import { getPlatformValue } from "../src/lib/platformConfig";
import { initDb } from "../src/lib/db";

async function test() {
  await initDb();
  console.log("Active Provider:", getPlatformValue("AI_PROVIDER"));
  console.log("Active Model:", getPlatformValue("AI_MODEL"));

  // Minimal 1x1 black pixel PNG image base64
  const mockImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  try {
    const res = await callLLM({
      system: "You are a helpful assistant. If you see an image, describe its color.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: mockImageBase64
              }
            },
            {
              type: "text",
              text: "Please analyze this image and tell me what you see."
            }
          ]
        }
      ]
    });
    console.log("=== Response ===");
    console.log(JSON.stringify(res, null, 2));
  } catch (err: any) {
    console.error("=== Error ===");
    console.error(err.message || err);
  }
}

process.env.DATABASE_URL = "postgresql://aichart:589e6a3c7f11cbe0b1ec6cd9c79be93849f178bad04fcd56@127.0.0.1:5432/aichart";
test();
