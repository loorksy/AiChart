/**
 * Minimal Anthropic Messages API client with tool-use support.
 * Uses the platform-wide API key (model option (أ) from the plan).
 */

export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

const API_URL = "https://api.anthropic.com/v1/messages";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AnthropicResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function callAnthropic(params: {
  system: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
}): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "مفتاح Claude غير مُعدّ على الخادم بعد. أضِف ANTHROPIC_API_KEY في متغيرات البيئة.",
    );
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: params.maxTokens ?? 1500,
      system: params.system,
      messages: params.messages,
      ...(params.tools ? { tools: params.tools } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      body && typeof body === "object" && "error" in body
        ? (body as { error: { message: string } }).error?.message
        : `Anthropic error (HTTP ${res.status})`;
    throw new Error(msg || `Anthropic error (HTTP ${res.status})`);
  }

  return (await res.json()) as AnthropicResponse;
}
