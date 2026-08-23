/**
 * Minimal Anthropic Messages API client with tool-use support.
 * Uses the platform-wide API key (model option (أ) from the plan).
 */

import {
  fetchWithTimeout,
  httpTimeoutMs,
  IdleWatchdog,
  llmIdleTimeoutMs,
  llmTotalTimeoutMs,
} from "./externalFetch";
import { getPlatformValue } from "./platformConfig";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

// Single source of truth for the offered models lives in the leaf catalogue —
// the picker, the settings validator, and this client must never disagree.
export { ANTHROPIC_MODEL_CHOICES } from "./modelCatalog";

/**
 * The client does not decide WHICH model runs — lib/llm.ts resolves that from
 * the operator's configuration and passes it explicitly on every call. This
 * constant is only the last-resort fallback for a call that named none; it
 * deliberately does NOT read ANTHROPIC_MODEL, because a second reader of the
 * same key is a second opinion, and the two can disagree.
 */
export function getAnthropicModel(): string {
  return DEFAULT_ANTHROPIC_MODEL;
}

const API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Claude 4.7+/5-family models reason before answering (adaptive thinking) and
 * thinking tokens count against max_tokens — a 4K budget can be consumed
 * before the visible answer starts. Give these models real headroom.
 */
const THINKING_MODELS = /^claude-(fable-5|mythos-5|opus-5|opus-4-[78]|sonnet-5)/;
const THINKING_MIN_TOKENS = 8192;
const THINKING_MAX_TOKENS = 16000;

/**
 * Claude 4.6 and later emit far more than the 4096 tokens `clampMaxTokens`
 * allows — that ceiling is an artifact of the 3.x era.
 *
 * Leaving it in place silently truncated any caller that asked for more, and
 * truncation is not a soft failure here: the final-decision synthesizer asks
 * for one large JSON object, so a reply cut mid-object is unparseable, gets
 * classified as "invalid_json", and is RETRIED against the same too-small
 * budget. Two truncated attempts consume the whole 95s stage deadline and the
 * operator sees "the final decision did not finish within the allowed time"
 * with nothing naming the real cause. The same trap was found and fixed on the
 * OpenAI path (openaiCompat.ts, REASONING_MIN_TOKENS) and never here — which
 * is why analysis worked on gpt-5 and stopped working the day the operator
 * switched the provider to Anthropic.
 *
 * The ceiling stays: a caller that asks for nothing still gets the routine
 * default, and an unrecognised (older) model keeps the conservative 4096.
 */
const LARGE_OUTPUT_MODELS =
  /^claude-(fable-5|mythos-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|haiku-4-5)/;
const LARGE_OUTPUT_MAX_TOKENS = 16000;

function requestBudget(model: string, requested?: number): number {
  if (THINKING_MODELS.test(model)) {
    const v = requested ?? THINKING_MIN_TOKENS;
    return Math.min(Math.max(v, THINKING_MIN_TOKENS), THINKING_MAX_TOKENS);
  }
  if (LARGE_OUTPUT_MODELS.test(model)) {
    const v = requested ?? DEFAULT_MAX_TOKENS;
    return Math.min(Math.max(v, 256), LARGE_OUTPUT_MAX_TOKENS);
  }
  return clampMaxTokens(requested);
}

/**
 * Fable/Mythos run thinking always-on and reject any explicit config; Opus 5
 * and Sonnet 5 run adaptive when the field is omitted. Only Opus 4.8/4.7 need
 * the explicit adaptive opt-in.
 */
function thinkingConfig(model: string): Record<string, unknown> {
  if (/^claude-opus-4-[78]/.test(model)) {
    return { thinking: { type: "adaptive" } };
  }
  return {};
}

/**
 * Thinking blocks are internal — callers of this client are single-turn
 * generations that read text/tool_use only, so the blocks are stripped rather
 * than leaked into summaries or JSON parsers.
 */
function stripThinking(content: ContentBlock[]): ContentBlock[] {
  return content.filter((block) => {
    const type = (block as { type?: string }).type;
    return type !== "thinking" && type !== "redacted_thinking";
  });
}

const REFUSAL_MESSAGE =
  "رفضت أنظمة الحماية لدى مزوّد النموذج هذا الطلب — أعد الصياغة أو اختر نموذج Claude آخر (مثل Opus).";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type CacheControl = { cache_control: { type: "ephemeral" } };

export const DEFAULT_MAX_TOKENS = 4096;
export const ROUTINE_MAX_TOKENS = 4096;

export type SystemPromptInput =
  | string
  | { static: string; dynamic?: string };

/**
 * Prompt caching: static system + tools prefix cached; dynamic tail and last
 * message block cached for multi-step tool loops (~10% read cost).
 */
function buildSystemBlocks(
  system: SystemPromptInput,
): Array<{ type: "text"; text: string } & Partial<CacheControl>> {
  if (typeof system === "string") {
    return [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ];
  }
  const blocks: Array<{ type: "text"; text: string } & Partial<CacheControl>> = [
    {
      type: "text",
      text: system.static,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (system.dynamic?.trim()) {
    blocks.push({ type: "text", text: system.dynamic });
  }
  return blocks;
}

function clampMaxTokens(n?: number): number {
  const v = n ?? DEFAULT_MAX_TOKENS;
  return Math.min(Math.max(v, 256), ROUTINE_MAX_TOKENS);
}

function cachedTools(tools?: ToolDef[]): (ToolDef | (ToolDef & CacheControl))[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t, i) =>
    i === tools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" as const } }
      : t,
  );
}

function cachedMessages(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1]!;
  const content: ContentBlock[] =
    typeof last.content === "string"
      ? last.content
        ? [{ type: "text", text: last.content }]
        : []
      : [...last.content];
  if (content.length === 0) return messages;
  const lastBlock = {
    ...content[content.length - 1]!,
    cache_control: { type: "ephemeral" as const },
  } as unknown as ContentBlock;
  return [
    ...messages.slice(0, -1),
    { ...last, content: [...content.slice(0, -1), lastBlock] },
  ];
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

    const res = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        cache: "no-store",
      },
      { timeoutMs: httpTimeoutMs(), label: "Anthropic models" },
    );

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
  system: SystemPromptInput;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
  /** Model override (tiering); defaults to the configured platform model. */
  model?: string;
  /** Caller cancellation — tears down the in-flight HTTP request. */
  signal?: AbortSignal;
  /** Per-call HTTP budget; falls back to the global LLM timeout. */
  timeoutMs?: number;
}): Promise<AnthropicResponse> {
  const apiKey = getPlatformValue("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "مفتاح Claude غير مُعدّ. أضِفه من لوحة المفاتيح الإدارية.",
    );
  }
  const model = params.model?.trim() || getAnthropicModel();

  const res = await fetchWithTimeout(
    API_URL,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: requestBudget(model, params.maxTokens),
        system: buildSystemBlocks(params.system),
        messages: cachedMessages(params.messages),
        ...thinkingConfig(model),
        ...(params.tools ? { tools: cachedTools(params.tools) } : {}),
      }),
      cache: "no-store",
      signal: params.signal ?? null,
    },
    { timeoutMs: params.timeoutMs ?? llmTotalTimeoutMs(), label: `Claude ${model}` },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const apiMsg =
      body && typeof body === "object" && "error" in body
        ? (body as { error: { message?: string; type?: string } }).error
            ?.message
        : undefined;
    const msg =
      (apiMsg ? `HTTP ${res.status} من ${model}: ${apiMsg}` : undefined) ||
      (res.status === 404
        ? `النموذج «${model}» غير متاح. اختر نموذجاً آخر من إعدادات المفاتيح.`
        : `خطأ من Claude ${model} (HTTP ${res.status})`);
    throw new Error(msg);
  }

  const data = (await res.json()) as AnthropicResponse;
  if (data.stop_reason === "refusal") {
    throw new Error(REFUSAL_MESSAGE);
  }
  return { ...data, content: stripThinking(data.content) };
}

export interface StreamHandlers {
  onTextDelta?: (text: string) => void;
}

/** Streaming Messages API — accumulates full response while emitting text deltas. */
export async function callAnthropicStream(
  params: {
    system: SystemPromptInput;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    /** Model override (tiering); defaults to the configured platform model. */
    model?: string;
    /** Caller cancellation — tears down the in-flight stream. */
    signal?: AbortSignal;
  },
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  const apiKey = getPlatformValue("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "مفتاح Claude غير مُعدّ. أضِفه من لوحة المفاتيح الإدارية.",
    );
  }
  const model = params.model?.trim() || getAnthropicModel();

  const watchdog = new IdleWatchdog(llmIdleTimeoutMs(), "Claude");
  const watchdogSignal = watchdog.start();
  const signal = params.signal
    ? AbortSignal.any([watchdogSignal, params.signal])
    : watchdogSignal;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: requestBudget(model, params.maxTokens),
      system: buildSystemBlocks(params.system),
      messages: cachedMessages(params.messages),
      stream: true,
      ...thinkingConfig(model),
      ...(params.tools ? { tools: cachedTools(params.tools) } : {}),
    }),
    cache: "no-store",
    signal,
  }).catch((err) => {
    watchdog.clear();
    if (watchdog.timedOut) throw watchdog.error();
    throw err;
  });

  if (!res.ok) {
    watchdog.clear();
    const body = await res.json().catch(() => ({}));
    const apiMsg =
      body && typeof body === "object" && "error" in body
        ? (body as { error: { message?: string } }).error?.message
        : undefined;
    throw new Error(
      (apiMsg ? `HTTP ${res.status} من ${model}: ${apiMsg}` : undefined) ||
        (res.status === 404
          ? `النموذج «${model}» غير متاح. اختر نموذجاً آخر من إعدادات المفاتيح.`
          : `خطأ من Claude ${model} (HTTP ${res.status})`),
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    watchdog.clear();
    throw new Error("لا يوجد تدفّق من Claude.");
  }

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

  try {
   while (true) {
    const { value, done } = await reader.read();
    watchdog.kick();
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
  } catch (err) {
    if (watchdog.timedOut) throw watchdog.error();
    throw err;
  } finally {
    watchdog.clear();
  }

  finishTextBlock();
  finishToolBlock();

  if (stopReason === "refusal") {
    throw new Error(REFUSAL_MESSAGE);
  }

  return {
    id: messageId,
    content: contentBlocks,
    stop_reason: stopReason || "end_turn",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
