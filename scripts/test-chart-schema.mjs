/**
 * Quick OpenAI strict-schema validation probe for chart_analysis.
 * Usage: node scripts/test-chart-schema.mjs
 */
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const key = process.env.OPENAI_API_KEY;
const rawModel = process.env.AI_MODEL || "gpt-4o-mini";
const model = rawModel.startsWith("openai/") ? rawModel.slice(7) : rawModel;

if (!key) {
  console.error("OPENAI_API_KEY missing");
  process.exit(1);
}

const POINT_SCHEMA = {
  type: "object",
  properties: {
    time: { type: ["number", "null"] },
    price: { type: "number" },
    barsAhead: { type: ["number", "null"] },
  },
  required: ["time", "price", "barsAhead"],
  additionalProperties: false,
};

const DRAWING_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string" },
    label: { type: ["string", "null"] },
    confidence: { type: "number" },
    color: { type: ["string", "null"] },
    semanticRole: { type: ["string", "null"] },
    patternType: { type: ["string", "null"] },
    points: { type: "array", items: POINT_SCHEMA },
  },
  required: ["type", "label", "confidence", "color", "semanticRole", "patternType", "points"],
  additionalProperties: false,
};

const CHART_ANALYZE_SCHEMA = {
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
          type: {
            type: "string",
            enum: ["observation", "structure", "pattern", "risk", "decision", "drawing"],
          },
          text: { type: "string" },
          confidence: {
            type: ["string", "null"],
            enum: ["low", "medium", "high", null],
          },
          relatedDrawingIndex: { type: ["number", "null"] },
        },
        required: ["type", "text", "confidence", "relatedDrawingIndex"],
        additionalProperties: false,
      },
    },
    drawings: { type: "array", items: DRAWING_SCHEMA },
  },
  required: [
    "decision",
    "confidence",
    "entry",
    "stop_loss",
    "targets",
    "reason",
    "selected_pattern",
    "break_points",
    "forecast_path",
    "narrative",
    "factors",
    "liveReasoningLog",
    "drawings",
  ],
  additionalProperties: false,
};

const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    max_completion_tokens: 64,
    messages: [
      { role: "system", content: "Return minimal valid JSON per schema." },
      { role: "user", content: "EURUSD 1h wait — minimal response." },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "chart_analysis",
        strict: true,
        schema: CHART_ANALYZE_SCHEMA,
      },
    },
  }),
});

const body = await res.text();
console.log("model:", model);
console.log("status:", res.status);
console.log(body.slice(0, 2000));
process.exit(res.ok ? 0 : 1);
