import { callLLM } from "../src/lib/llm";
import { getPlatformValue } from "../src/lib/platformConfig";
import { initDb, queryOne } from "../src/lib/db";
import { parseImageFromMetadata } from "../src/lib/chatImage";

async function test() {
  await initDb();
  console.log("Active Provider:", getPlatformValue("AI_PROVIDER"));
  console.log("Active Model:", getPlatformValue("AI_MODEL"));

  // Find the last user message with image
  const row = await queryOne<{ metadata_json: string }>(
    "SELECT metadata_json FROM chat_messages WHERE role = 'user' AND metadata_json LIKE '%image%' ORDER BY id DESC LIMIT 1"
  );
  
  if (!row) {
    console.error("No chat message with image found in database.");
    return;
  }
  
  const image = parseImageFromMetadata(row.metadata_json);
  if (!image) {
    console.error("Failed to parse image from metadata_json.");
    return;
  }
  
  console.log(`Found image. Media type: ${image.media_type}, length: ${image.data.length}`);

  try {
    const res = await callLLM({
      system: "You are a helpful assistant. Describe what you see in the chart.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.media_type,
                data: image.data
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

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
test();
