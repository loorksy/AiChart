import { initDb } from "../src/lib/db";
import { getPlatformValueAsync } from "../src/lib/platformConfig";

async function main() {
  await initDb();
  
  const openaiKey = await getPlatformValueAsync("OPENAI_API_KEY");
  if (!openaiKey) {
    console.error("OPENAI_API_KEY is not set in the database.");
    return;
  }

  console.log("=== Direct OpenAI API Vision Test ===");
  console.log(`OPENAI_API_KEY starts with: ${openaiKey.slice(0, 15)}...`);

  // 1x1 black pixel PNG image base64
  const mockImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  try {
    console.log("Sending chat/completions request with image and model 'gpt-4o'...");
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
                  url: `data:image/png;base64,${mockImageBase64}`
                }
              },
              {
                type: "text",
                text: "Analyze this image and describe what color it is."
              }
            ]
          }
        ]
      })
    });

    console.log("HTTP Response Status:", res.status);
    const bodyText = await res.text();
    console.log("Raw Response Body:");
    console.log(bodyText);

  } catch (e: any) {
    console.error("Fetch request failed:", e.message || e);
  }
}

process.env.DATABASE_URL = "postgresql://aichart:589e6a3c7f11cbe0b1ec6cd9c79be93849f178bad04fcd56@127.0.0.1:5432/aichart";
main().catch(console.error);
