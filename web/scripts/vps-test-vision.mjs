import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const password = process.env.SSH_PASS;
const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null;

// Script to execute on VPS: runs a direct node script to test callLLM with a small mock image
const remoteNodeCode = `
const { callLLM } = require('/opt/aichart/web/src/lib/llm.ts');
const { getPlatformValue } = require('/opt/aichart/web/src/lib/platformConfig.ts');

async function test() {
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
  } catch (err) {
    console.error("=== Error ===");
    console.error(err.message || err);
  }
}

// Mock next/server context or node requirements if needed
// DATABASE_URL is inherited from the deployed service environment.
test();
`;

// Run using tsx on VPS
const remoteCmd = `curl -s http://127.0.0.1:3010/api/admin/test-agent-vision`;

function run() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.exec(remoteCmd, (err, stream) => {
          if (err) return reject(err);
          stream
            .on("close", (code) => {
              conn.end();
              if (code === 0) resolve();
              else reject(new Error(`remote exit ${code}`));
            })
            .on("data", (d) => process.stdout.write(d))
            .stderr.on("data", (d) => process.stderr.write(d));
        });
      })
      .on("error", reject)
      .connect({
        host: "72.60.83.140",
        port: 22,
        username: "root",
        ...(privateKey ? { privateKey } : { password }),
        readyTimeout: 60000,
        keepaliveInterval: 10000,
      });
  });
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
