import type { Message, ContentBlock } from "@/lib/anthropic";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { getActiveModel, getProviderApiKey } from "@/lib/llm";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { callOpenAISdkStructured } from "@/lib/openaiSdk";
import { buildSystemPrompt, chartAnalyzeSystemSuffix } from "@/lib/persona";
import { isGenericLogPhrase } from "@/lib/chart/chartTerminology";
import type { TradingSettings } from "@/lib/types";
import { buildUserMessageContent, type ChatImagePayload } from "@/lib/chatImage";
import { normalizeConfidence } from "@/lib/analysis/confidence";

export type LiveReasoningType =
  | "observation"
  | "structure"
  | "pattern"
  | "risk"
  | "decision"
  | "drawing";

export interface LiveReasoningEntry {
  type: LiveReasoningType;
  text: string;
  confidence?: "low" | "medium" | "high";
  relatedDrawingIndex?: number;
}

export interface ChartAnalyzeLlmResult {
  decision: "buy" | "sell" | "wait";
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  targets: number[];
  reason: string;
  selected_pattern: string | null;
  break_points: number[];
  forecast_path: number[];
  narrative: string;
  factors: string[];
  drawings: ChartDrawing[];
  liveReasoningLog: LiveReasoningEntry[];
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
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    color: { type: ["string", "null"] },
    width: { type: ["number", "null"] },
    style: { type: ["string", "null"], enum: ["solid", "dashed", "dotted", null] },
    fill: { type: ["boolean", "null"] },
    fill_color: { type: ["string", "null"] },
    semanticRole: { type: ["string", "null"] },
    patternType: { type: ["string", "null"] },
    points: { type: "array", items: POINT_SCHEMA },
    meta: {
      type: ["object", "null"],
      properties: {
        entry: { type: ["number", "null"] },
        stopLoss: { type: ["number", "null"] },
        takeProfit: { type: ["number", "null"] },
      },
      required: ["entry", "stopLoss", "takeProfit"],
      additionalProperties: false,
    },
  },
  required: [
    "type",
    "label",
    "confidence",
    "color",
    "width",
    "style",
    "fill",
    "fill_color",
    "semanticRole",
    "patternType",
    "points",
    "meta",
  ],
  additionalProperties: false,
};

const CHART_ANALYZE_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["buy", "sell", "wait"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
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
        },
        required: ["type", "text"],
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
} as const;

const LOG_TYPES = new Set<LiveReasoningType>([
  "observation",
  "structure",
  "pattern",
  "risk",
  "decision",
  "drawing",
]);

export function sanitizeLiveReasoningLog(
  entries: LiveReasoningEntry[] | undefined,
): LiveReasoningEntry[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const out: LiveReasoningEntry[] = [];
  for (const e of entries) {
    const text = String(e.text ?? "").trim();
    if (!text || text.length < 8) continue;
    if (isGenericLogPhrase(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    const type = LOG_TYPES.has(e.type as LiveReasoningType)
      ? (e.type as LiveReasoningType)
      : "observation";
    out.push({
      type,
      text,
      ...(e.confidence ? { confidence: e.confidence } : {}),
      ...(e.relatedDrawingIndex != null && e.relatedDrawingIndex >= 0
        ? { relatedDrawingIndex: e.relatedDrawingIndex }
        : {}),
    });
    if (out.length >= 7) break;
  }
  return out;
}

function compatTarget(apiKey: string) {
  if (!apiKey) throw new Error("مفتاح OpenAI غير مُعدّ.");
  const model = getActiveModel();
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    model: model.startsWith("openai/") ? model.slice("openai/".length) : model,
  };
}

function flattenSystem(input: Awaited<ReturnType<typeof buildSystemPrompt>>): string {
  return input.dynamic?.trim()
    ? `${input.static}\n\n${input.dynamic}`
    : input.static;
}

export async function runChartAnalyzeLlm(opts: {
  userId: number;
  settings: TradingSettings;
  userPrompt: string;
  userContent?: string | ContentBlock[];
  onDelta?: (text: string) => void;
}): Promise<{ result: ChartAnalyzeLlmResult; usageTokens: number }> {
  const systemBase = await buildSystemPrompt(opts.settings, opts.userId);
  const system =
    flattenSystem(systemBase) +
    chartAnalyzeSystemSuffix() +
    "\n\nأعد JSON فقط حسب المخطط — decision/liveReasoningLog/drawings مع time+price.";

  const messages: Message[] = [
    {
      role: "user",
      content: opts.userContent ?? opts.userPrompt,
    },
  ];

  const apiKey =
    getProviderApiKey("openai") ??
    (await getPlatformValueAsync("OPENAI_API_KEY"));
  if (!apiKey) throw new Error("مفتاح OpenAI غير مُعدّ.");

  const { data, usage } = await callOpenAISdkStructured<Record<string, unknown>>(
    compatTarget(apiKey),
    {
      system,
      messages,
      schemaName: "chart_analysis",
      schema: CHART_ANALYZE_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 8192,
    },
    opts.onDelta ? { onTextDelta: opts.onDelta } : undefined,
  );

  const parsed = data as unknown as ChartAnalyzeLlmResult;
  const liveLog = sanitizeLiveReasoningLog(parsed.liveReasoningLog);
  const drawings = Array.isArray(parsed.drawings)
    ? (parsed.drawings as ChartDrawing[]).map((drawing) => ({
        ...drawing,
        confidence: normalizeConfidence(drawing.confidence),
      }))
    : [];
  const factors =
    liveLog.length >= 3
      ? liveLog.map((e) => e.text)
      : Array.isArray(parsed.factors)
        ? parsed.factors.map(String)
        : [];

  return {
    result: {
      ...parsed,
      decision:
        parsed.decision === "buy" || parsed.decision === "sell" ? parsed.decision : "wait",
      confidence: normalizeConfidence(parsed.confidence),
      entry: parsed.entry != null ? Number(parsed.entry) : null,
      stop_loss: parsed.stop_loss != null ? Number(parsed.stop_loss) : null,
      targets: Array.isArray(parsed.targets) ? parsed.targets.map(Number) : [],
      reason: String(parsed.reason ?? ""),
      selected_pattern: parsed.selected_pattern ?? null,
      break_points: Array.isArray(parsed.break_points)
        ? parsed.break_points.map(Number)
        : [],
      forecast_path: Array.isArray(parsed.forecast_path)
        ? parsed.forecast_path.map(Number)
        : [],
      narrative: String(parsed.narrative ?? parsed.reason ?? ""),
      factors,
      liveReasoningLog: liveLog,
      drawings,
    },
    usageTokens: usage.input_tokens + usage.output_tokens,
  };
}

export function buildChartAnalyzeUserContent(
  prompt: string,
  chartImage?: ChatImagePayload | null,
): string | ContentBlock[] {
  if (!chartImage) return prompt;
  return buildUserMessageContent(prompt, chartImage, false);
}
