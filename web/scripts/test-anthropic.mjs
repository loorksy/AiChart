import Database from "better-sqlite3";
import crypto from "crypto";

function getEncryptionKey() {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  const db = new Database("data/aichart.db");
  const row = db
    .prepare("SELECT value FROM platform_config WHERE key = 'ENCRYPTION_KEY' AND plain = 1")
    .get();
  if (row?.value) return row.value;
  return crypto.createHash("sha256").update("aichart-dev-encryption-key").digest("hex");
}

function decrypt(payload) {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const key = Buffer.from(getEncryptionKey(), "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

const db = new Database("data/aichart.db");
const apiRow = db.prepare("SELECT value FROM platform_config WHERE key = 'ANTHROPIC_API_KEY'").get();
const modelRow = db.prepare("SELECT value FROM platform_config WHERE key = 'ANTHROPIC_MODEL'").get();

let apiKey;
try {
  apiKey = decrypt(apiRow.value);
  console.log("decrypt ok, key prefix:", apiKey.slice(0, 12));
} catch (e) {
  console.error("decrypt FAILED", e.message);
  process.exit(1);
}

const model = modelRow?.value || "claude-3-5-sonnet-latest";
console.log("model:", model);

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    max_tokens: 40,
    messages: [{ role: "user", content: "Say hi" }],
  }),
});

const body = await res.json();
console.log("status", res.status);
console.log(JSON.stringify(body, null, 2));
