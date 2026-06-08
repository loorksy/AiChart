/**
 * Minimal Anthropic Messages API client with tool-use support.
 * Uses the platform-wide API key (model option (أ) from the plan).
 */

import { getPlatformValue } from "./platformConfig";

export function getAnthropicModel(): string {
  return getPlatformValue("ANTHROPIC_MODEL") || "claude-sonnet-4-6";
}

const API_URL = "https://api.anthropic.com/v1/messages";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: ImageMediaType;
        data: string;
      };
    }
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
  return Boolean(getPlatformValue("ANTHROPIC_API_KEY"));
}

export interface AnthropicModelInfo {
  id: string;
  display_name: string;
  created_at?: string;
  max_input_tokens?: number;
}

const MODELS_URL = "https://api.anthropic.com/v1/models";

/** Lists models available to the given API key (or platform key). */
export async function listAnthropicModels(
  apiKey?: string,
): Promise<AnthropicModelInfo[]> {
  const key = apiKey ?? getPlatformValue("ANTHROPIC_API_KEY");
  if (!key) {
    throw new Error("مفتاح Claude غير مُعدّ.");
  }

  const models: AnthropicModelInfo[] = [];
  let afterId: string | undefined;

  for (let page = 0; page < 20; page++) {
    const url = new URL(MODELS_URL);
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);

    const res = await fetch(url.toString(), {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg =
        body && typeof body === "object" && "error" in body
          ? (body as { error: { message: string } }).error?.message
          : `Anthropic models error (HTTP ${res.status})`;
      throw new Error(msg || `Anthropic models error (HTTP ${res.status})`);
    }

    const data = (await res.json()) as {
      data?: AnthropicModelInfo[];
      has_more?: boolean;
      last_id?: string;
    };

    for (const m of data.data ?? []) {
      models.push({
        id: m.id,
        display_name: m.display_name || m.id,
        created_at: m.created_at,
        max_input_tokens: m.max_input_tokens,
      });
    }

    if (!data.has_more || !data.last_id) break;
    afterId = data.last_id;
  }

  return models;
}

export async function callAnthropic(params: {
  system: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
}): Promise<AnthropicResponse> {
  const apiKey = getPlatformValue("ANTHROPIC_API_KEY");
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
      model: getAnthropicModel(),
      max_tokens: params.maxTokens ?? 1500,
      system: params.system,
      messages: params.messages,
      ...(params.tools ? { tools: params.tools } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const apiMsg =
      body && typeof body === "object" && "error" in body
        ? (body as { error: { message?: string; type?: string } }).error
            ?.message
        : undefined;
    const model = getAnthropicModel();
    const msg =
      apiMsg ||
      (res.status === 404
        ? `النموذج «${model}» غير متاح. اختر نموذجاً آخر من إعدادات المفاتيح.`
        : `خطأ من Claude (HTTP ${res.status})`);
    throw new Error(msg);
  }

  return (await res.json()) as AnthropicResponse;
}

export interface StreamHandlers {
  onTextDelta?: (text: string) => void;
}

/** Streaming Messages API — accumulates full response while emitting text deltas. */
export async function callAnthropicStream(
  params: {
    system: string;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
  },
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  const apiKey = getPlatformValue("ANTHROPIC_API_KEY");
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
      model: getAnthropicModel(),
      max_tokens: params.maxTokens ?? 1500,
      system: params.system,
      messages: params.messages,
      stream: true,
      ...(params.tools ? { tools: params.tools } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const apiMsg =
      body && typeof body === "object" && "error" in body
        ? (body as { error: { message?: string } }).error?.message
        : undefined;
    const model = getAnthropicModel();
    throw new Error(
      apiMsg ||
        (res.status === 404
          ? `النموذج «${model}» غير متاح. اختر نموذجاً آخر من إعدادات المفاتيح.`
          : `خطأ من Claude (HTTP ${res.status})`),
    );
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("لا يوجد تدفّق من Claude.");

  const decoder = new TextDecoder();
  let buffer = "";
  let messageId = "";
  let stopReason = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const contentBlocks: ContentBlock[] = [];
  let currentBlockIndex = -1;
  let currentText = "";
  let currentToolId = "";
  let currentToolName = "";
  let currentToolJson = "";

  const finishTextBlock = () => {
    if (currentText) {
      contentBlocks.push({ type: "text", text: currentText });
      currentText = "";
    }
  };

  const finishToolBlock = () => {
    if (currentToolId && currentToolName) {
      let input: Record<string, unknown> = {};
      try {
        input = currentToolJson ? JSON.parse(currentToolJson) : {};
      } catch {
        input = {};
      }
      contentBlocks.push({
        type: "tool_use",
        id: currentToolId,
        name: currentToolName,
        input,
      });
      currentToolId = "";
      currentToolName = "";
      currentToolJson = "";
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = String(event.type ?? "");

      if (type === "message_start") {
        const msg = event.message as { id?: string; usage?: { input_tokens?: number } };
        messageId = msg?.id ?? "";
        inputTokens = msg?.usage?.input_tokens ?? 0;
      } else if (type === "content_block_start") {
        const block = event.content_block as {
          type?: string;
          id?: string;
          name?: string;
        };
        currentBlockIndex = Number(event.index ?? 0);
        if (block?.type === "text") {
          finishToolBlock();
          currentText = "";
        } else if (block?.type === "tool_use") {
          finishTextBlock();
          currentToolId = block.id ?? "";
          currentToolName = block.name ?? "";
          currentToolJson = "";
        }
      } else if (type === "content_block_delta") {
        const delta = event.delta as { type?: string; text?: string; partial_json?: string };
        if (delta?.type === "text_delta" && delta.text) {
          currentText += delta.text;
          handlers?.onTextDelta?.(delta.text);
        } else if (delta?.type === "input_json_delta" && delta.partial_json) {
          currentToolJson += delta.partial_json;
        }
      } else if (type === "content_block_stop") {
        if (currentText) finishTextBlock();
        else if (currentToolId) finishToolBlock();
      } else if (type === "message_delta") {
        const delta = event.delta as { stop_reason?: string };
        stopReason = delta?.stop_reason ?? stopReason;
        const usage = event.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens) outputTokens = usage.output_tokens;
      }
    }
  }

  finishTextBlock();
  finishToolBlock();

  return {
    id: messageId,
    content: contentBlocks,
    stop_reason: stopReason || "end_turn",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
