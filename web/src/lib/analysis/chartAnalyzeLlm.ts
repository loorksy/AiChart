import type { Message, ContentBlock } from "@/lib/anthropic";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { getActiveModel, getProviderApiKey } from "@/lib/llm";
import { callOpenAICompatStructured } from "@/lib/openaiCompat";
import { buildSystemPrompt, chartAnalyzeSystemSuffix } from "@/lib/persona";
import type { TradingSettings } from "@/lib/types";
import { buildUserMessageContent, type ChatImagePayload } from "@/lib/chatImage";

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
}

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
    drawings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          label: { type: "string" },
          confidence: { type: "number" },
          color: { type: "string" },
          price: { type: "number" },
          points: {
            type: "array",
            items: {
              type: "object",
              properties: {
                barsAhead: { type: "number" },
                price: { type: "number" },
              },
              required: ["barsAhead", "price"],
              additionalProperties: false,
            },
          },
        },
        required: ["type", "confidence", "points"],
        additionalProperties: false,
      },
    },
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
    "drawings",
  ],
  additionalProperties: false,
} as const;

function compatTarget() {
  const apiKey = getProviderApiKey("openai");
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

/** Single structured OpenAI call — precomputed analysis is injected in the user prompt. */
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
    "\n\nأعد JSON فقط حسب المخطط — decision/confidence/entry/stop_loss/targets/reason/narrative/drawings/factors.";

  const messages: Message[] = [
    {
      role: "user",
      content: opts.userContent ?? opts.userPrompt,
    },
  ];

  const { data, usage } = await callOpenAICompatStructured<Record<string, unknown>>(
    compatTarget(),
    {
      system,
      messages,
      schemaName: "chart_analysis",
      schema: CHART_ANALYZE_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 4096,
    },
    opts.onDelta ? { onTextDelta: opts.onDelta } : undefined,
  );

  const parsed = data as unknown as ChartAnalyzeLlmResult;

  return {
    result: {
      ...parsed,
      decision:
        parsed.decision === "buy" || parsed.decision === "sell" ? parsed.decision : "wait",
      confidence: Math.round(Number(parsed.confidence) || 0),
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
      factors: Array.isArray(parsed.factors) ? parsed.factors.map(String) : [],
      drawings: Array.isArray(parsed.drawings) ? (parsed.drawings as ChartDrawing[]) : [],
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
