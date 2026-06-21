import { initDb, queryOne } from "../src/lib/db";
import { getPlatformValueAsync } from "../src/lib/platformConfig";
import { parseImageFromMetadata } from "../src/lib/chatImage";

async function main() {
  await initDb();
  
  // Find the last user message with an image
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
  
  const openaiKey = await getPlatformValueAsync("OPENAI_API_KEY");
  if (!openaiKey) {
    console.error("OPENAI_API_KEY is not set.");
    return;
  }
  
  console.log("Sending user's actual image to OpenAI API gpt-4o...");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${image.media_type};base64,${image.data}`
                }
              },
              {
                type: "text",
                text: "Tell me what you see in this chart."
              }
            ]
          }
        ]
      })
    });
    
    console.log("HTTP Response Status:", res.status);
    const bodyText = await res.text();
    console.log("Response Body:");
    console.log(bodyText);
  } catch (e: any) {
    console.error("Fetch request failed:", e.message || e);
  }
}

process.env.DATABASE_URL = "postgresql://aichart:589e6a3c7f11cbe0b1ec6cd9c79be93849f178bad04fcd56@127.0.0.1:5432/aichart";
main().catch(console.error);
