import pg from "pg";
import fs from "fs";
import crypto from "crypto";

process.chdir("/opt/aichart/web");
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

function decryptSecret(payload) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  "SELECT key, value, plain FROM platform_config WHERE key IN ('OPENAI_API_KEY','AI_MODEL')",
);
await c.end();

let model = "gpt-4.1";
let key = null;
for (const row of r.rows) {
  if (row.key === "AI_MODEL") model = String(row.value).replace(/^openai\//, "");
  if (row.key === "OPENAI_API_KEY") key = row.plain ? row.value : decryptSecret(row.value);
}

console.log("AI_MODEL:", model);

const schema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["buy", "sell", "wait"] },
    confidence: { type: "number" },
    entry: { type: ["number", "null"] },
    stop_loss: { type: ["number", "null"] },
    targets: { type: "array", items: { type: "number" } },
    reason: { type: "string" },
    selected_pattern: { type: ["string", "null"] },
    break_points: { type: "array", items: { type: "number" } },
    forecast_path: { type: "array", items: { type: "number" } },
    narrative: { type: "string" },
    factors: { type: "array", items: { type: "string" } },
    liveReasoningLog: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["observation", "structure", "pattern", "risk", "decision", "drawing"] },
          text: { type: "string" },
          confidence: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
          relatedDrawingIndex: { type: ["number", "null"] },
        },
        required: ["type", "text", "confidence", "relatedDrawingIndex"],
        additionalProperties: false,
      },
    },
    drawings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          label: { type: ["string", "null"] },
          confidence: { type: "number" },
          color: { type: ["string", "null"] },
          semanticRole: { type: ["string", "null"] },
          patternType: { type: ["string", "null"] },
          points: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time: { type: ["number", "null"] },
                price: { type: "number" },
                barsAhead: { type: ["number", "null"] },
              },
              required: ["time", "price", "barsAhead"],
              additionalProperties: false,
            },
          },
        },
        required: ["type", "label", "confidence", "color", "semanticRole", "patternType", "points"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "decision", "confidence", "entry", "stop_loss", "targets", "reason",
    "selected_pattern", "break_points", "forecast_path", "narrative", "factors",
    "liveReasoningLog", "drawings",
  ],
  additionalProperties: false,
};

const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    model,
    max_completion_tokens: 64,
    messages: [{ role: "user", content: "wait EURUSD minimal" }],
    response_format: { type: "json_schema", json_schema: { name: "chart_analysis", strict: true, schema } },
  }),
});
console.log("HTTP", res.status);
console.log((await res.text()).slice(0, 2500));
