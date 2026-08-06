/**
 * OpenAI-compatible chat-completions client.
 * same dialect). Converts to/from the Anthropic-shaped Message / ToolDef /
 * ContentBlock types used across the codebase so callers never change.
 */

import type {
  AnthropicResponse,
  ContentBlock,
  Message,
  StreamHandlers,
  ToolDef,
} from "./anthropic";
import {
  ExternalTimeoutError,
  fetchWithTimeout,
  httpTimeoutMs,
  IdleWatchdog,
  llmIdleTimeoutMs,
  llmTotalTimeoutMs,
  llmTtftTimeoutMs,
} from "./externalFetch";
import { resilientFetch } from "./providerResilience";
import { isReasoningModel } from "./modelCatalog";

export interface OpenAICompatTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra optional HTTP headers for the upstream API */
  headers?: Record<string, string>;
}

// ---------- request conversion ----------

interface OAToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OAContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OAMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OAContentPart[] | null;
  tool_calls?: OAToolCall[];
  tool_call_id?: string;
}

function blocksToOA(msg: Message): OAMessage[] {
  if (typeof msg.content === "string") {
    return [{ role: msg.role, content: msg.content }];
  }

  const out: OAMessage[] = [];
  const parts: OAContentPart[] = [];
  const toolCalls: OAToolCall[] = [];
  const toolResults: OAMessage[] = [];

  for (const block of msg.content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    } else if (block.type === "tool_result") {
      toolResults.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: block.is_error
          ? `ERROR: ${block.content}`
          : block.content,
      });
    }
  }

  if (msg.role === "assistant") {
    const m: OAMessage = {
      role: "assistant",
      content: parts.length > 0 ? parts : null,
    };
    if (toolCalls.length > 0) m.tool_calls = toolCalls;
    out.push(m);
  } else {
    // Tool results must come first (right after the assistant tool_calls turn)
    out.push(...toolResults);
    if (parts.length > 0) out.push({ role: "user", content: parts });
    else if (toolResults.length === 0) out.push({ role: "user", content: "" });
  }

  return out;
}

function toOAMessages(system: string, messages: Message[]): OAMessage[] {
  const out: OAMessage[] = [{ role: "system", content: system }];
  for (const m of messages) out.push(...blocksToOA(m));
  return out;
}

/** Model id without OpenRouter vendor prefix (e.g. openai/gpt-4.1 → gpt-4.1). */
function bareModelId(model: string): string {
  const trimmed = model.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Newer OpenAI chat models reject `max_tokens` and require `max_completion_tokens`.
 * Claude-via-OpenRouter keeps using `max_tokens`, which is also the fallback.
 */
export function openAICompatTokenLimitField(
  model: string,
): "max_tokens" | "max_completion_tokens" {
  const id = bareModelId(model);
  if (/^o\d/.test(id)) return "max_completion_tokens";
  if (/^gpt-5/.test(id)) return "max_completion_tokens";
  if (/^gpt-4\.1/.test(id)) return "max_completion_tokens";
  return "max_tokens";
}

/**
 * Reasoning-family models (o-series, gpt-5) spend part of the completion
 * budget on hidden reasoning tokens before the visible JSON/text starts — the
 * same problem anthropic.ts's THINKING_MODELS solves for Claude 5-family
 * extended thinking. A cap sized for a fast, non-reasoning model (4096) can
 * be entirely consumed by reasoning, truncating the answer (finish_reason:
 * "length"), which forces callers with a JSON-parse retry loop (e.g. the
 * final-decision synthesizer) to re-run the whole reasoning pass — and that
 * retry is what actually blows a shared stage deadline sized for one attempt.
 */
const REASONING_MIN_TOKENS = 8192;
const REASONING_MAX_TOKENS = 16000;

function tokenLimitBody(
  model: string,
  maxTokens?: number,
): Record<string, number> {
  const limit = isReasoningModel(model)
    ? Math.min(
        Math.max(maxTokens ?? REASONING_MIN_TOKENS, REASONING_MIN_TOKENS),
        REASONING_MAX_TOKENS,
      )
    : Math.min(maxTokens ?? 4096, 4096);
  const field = openAICompatTokenLimitField(model);
  return { [field]: limit };
}

/**
 * Reasoning-family models (o-series, gpt-5) "think" before answering. Pin the
 * effort low on the interactive path so first-byte latency stays well under the
 * TTFT budget instead of stalling for tens of seconds.
 */
function reasoningBody(model: string): Record<string, unknown> {
  if (isReasoningModel(model)) return { reasoning_effort: "low" };
  return {};
}

// Exported for provider-parity tests: proves any tool (e.g. render_cards)
// converts to the OpenAI-compatible function shape used by openai/google/openrouter.
export function toOATools(tools?: ToolDef[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ---------- response conversion ----------

// Exported for provider-parity tests: proves OpenAI-shaped tool_calls are
// normalized back into the unified tool_use blocks the agent loop consumes.
export function fromOAChoice(choice: {
  message?: {
    content?: string | null;
    tool_calls?: OAToolCall[];
  };
  finish_reason?: string;
}): { content: ContentBlock[]; stop_reason: string } {
  const blocks: ContentBlock[] = [];
  const msg = choice.message;

  if (msg?.content) {
    blocks.push({ type: "text", text: msg.content });
  }
  for (const tc of msg?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      input = {};
    }
    blocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input,
    });
  }

  const finish = choice.finish_reason ?? "stop";
  const stop_reason =
    finish === "tool_calls"
      ? "tool_use"
      : finish === "length"
        ? "max_tokens"
        : "end_turn";

  return { content: blocks, stop_reason };
}

async function readError(res: Response, label: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string } | string;
  };
  const err = body?.error;
  const apiMsg =
    typeof err === "string" ? err : err?.message ? err.message : undefined;

  if (apiMsg && apiMsg.toLowerCase().includes("image_url")) {
    return "النموذج النشط حالياً لا يدعم تحليل صور الشارت. يرجى تعديل خيارات نموذج الذكاء الاصطناعي في لوحة التحكم الإدارية (المفاتيح) وتفعيل نموذج يدعم الرؤية (مثل GPT-4o أو Claude 3.5 Sonnet).";
  }

  // Always carry the HTTP status + model: the error classifier keys on the
  // status code, and the operator log needs to say WHICH model was rejected.
  return apiMsg
    ? `HTTP ${res.status} من ${label}: ${apiMsg}`
    : `خطأ من ${label} (HTTP ${res.status})`;
}

// ---------- public API ----------

export async function callOpenAICompat(
  target: OpenAICompatTarget,
  params: {
    system: string;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    /** Caller cancellation/deadline — aborts the in-flight HTTP call. */
    signal?: AbortSignal;
  },
): Promise<AnthropicResponse> {
  // Circuit breaker (RELIABILITY_PLAN.md item 6): a provider outage fails fast
  // instead of every request burning its full timeout. No added retries here —
  // callers that retry (the final-decision synthesizer) keep sole ownership of
  // retry policy, so this never double-retries.
  const res = await resilientFetch(
    "openai",
    `${target.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.apiKey}`,
        "content-type": "application/json",
        ...target.headers,
      },
      body: JSON.stringify({
        model: target.model,
        ...tokenLimitBody(target.model, params.maxTokens),
        ...reasoningBody(target.model),
        messages: toOAMessages(params.system, params.messages),
        ...(params.tools ? { tools: toOATools(params.tools) } : {}),
      }),
      cache: "no-store",
    },
    { timeoutMs: llmTotalTimeoutMs(), label: target.model, signal: params.signal },
  );

  if (!res.ok) throw new Error(await readError(res, target.model));

  const data = (await res.json()) as {
    id?: string;
    choices?: Parameters<typeof fromOAChoice>[0][];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = data.choices?.[0];
  if (!choice) throw new Error(`رد فارغ من ${target.model}`);

  const { content, stop_reason } = fromOAChoice(choice);
  return {
    id: data.id ?? "",
    content,
    stop_reason,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

export async function callOpenAICompatStream(
  target: OpenAICompatTarget,
  params: {
    system: string;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    /** Caller cancellation/deadline — aborts the in-flight stream. */
    signal?: AbortSignal;
  },
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  // One gentle retry, but only when the first attempt stalled BEFORE delivering
  // any bytes — retrying after partial text would duplicate it on the client.
  let delivered = false;
  const guardedHandlers: StreamHandlers | undefined = handlers
    ? {
        ...handlers,
        onTextDelta: (t: string) => {
          delivered = true;
          handlers.onTextDelta?.(t);
        },
      }
    : undefined;

  try {
    return await streamOnce(target, params, guardedHandlers);
  } catch (err) {
    if (err instanceof ExternalTimeoutError && !delivered) {
      return await streamOnce(target, params, guardedHandlers);
    }
    throw err;
  }
}

async function streamOnce(
  target: OpenAICompatTarget,
  params: {
    system: string;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    signal?: AbortSignal;
  },
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  const watchdog = new IdleWatchdog(
    llmIdleTimeoutMs(),
    target.model,
    llmTtftTimeoutMs(),
  );
  // A caller abort (client disconnect / stage deadline / total run budget) must
  // tear down the in-flight stream, not just stop awaiting it: the watchdog's
  // controller is the one signal fetch sees, so link the caller into it.
  const streamSignal = watchdog.start();
  if (params.signal) {
    if (params.signal.aborted) watchdog.controller.abort();
    else {
      params.signal.addEventListener("abort", () => watchdog.controller.abort(), {
        once: true,
      });
    }
  }
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      "content-type": "application/json",
      ...target.headers,
    },
    body: JSON.stringify({
      model: target.model,
      ...tokenLimitBody(target.model, params.maxTokens),
      ...reasoningBody(target.model),
      messages: toOAMessages(params.system, params.messages),
      stream: true,
      ...(params.tools ? { tools: toOATools(params.tools) } : {}),
    }),
    cache: "no-store",
    signal: streamSignal,
  }).catch((err) => {
    watchdog.clear();
    // A caller abort is a deliberate cancellation, never a provider timeout.
    if (params.signal?.aborted) throw err;
    if (watchdog.timedOut) throw watchdog.error();
    throw err;
  });

  if (!res.ok) {
    watchdog.clear();
    throw new Error(await readError(res, target.model));
  }

  const reader = res.body?.getReader();
  if (!reader) {
    watchdog.clear();
    throw new Error(`لا يوجد تدفّق من ${target.model}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let messageId = "";
  let finishReason = "";
  let text = "";
  // tool calls accumulate by index
  const toolAcc = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  let inputTokens = 0;
  let outputTokens = 0;

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
      let event: {
        id?: string;
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: {
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
          finish_reason?: string | null;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }

      if (event.id) messageId = event.id;
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens ?? inputTokens;
        outputTokens = event.usage.completion_tokens ?? outputTokens;
      }

      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        handlers?.onTextDelta?.(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        toolAcc.set(idx, acc);
      }
    }
   }
  } catch (err) {
    if (watchdog.timedOut) throw watchdog.error();
    throw err;
  } finally {
    watchdog.clear();
  }

  const content: ContentBlock[] = [];
  if (text) content.push({ type: "text", text });
  for (const [, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
    if (!acc.id || !acc.name) continue;
    let input: Record<string, unknown> = {};
    try {
      input = acc.args ? JSON.parse(acc.args) : {};
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: acc.id, name: acc.name, input });
  }

  const stop_reason =
    finishReason === "tool_calls"
      ? "tool_use"
      : finishReason === "length"
        ? "max_tokens"
        : "end_turn";

  return {
    id: messageId,
    content,
    stop_reason,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

/** Single-pass structured JSON generation (OpenAI Structured Outputs). */
export async function callOpenAICompatStructured<T extends Record<string, unknown>>(
  target: OpenAICompatTarget,
  params: {
    system: string;
    messages: Message[];
    schemaName: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
  },
  handlers?: Pick<StreamHandlers, "onTextDelta">,
): Promise<{
  data: T;
  usage: { input_tokens: number; output_tokens: number };
}> {
  const res = await fetchWithTimeout(
    `${target.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.apiKey}`,
        "content-type": "application/json",
        ...target.headers,
      },
      body: JSON.stringify({
        model: target.model,
        ...tokenLimitBody(target.model, params.maxTokens ?? 4096),
        ...reasoningBody(target.model),
        messages: toOAMessages(params.system, params.messages),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: params.schemaName,
            strict: true,
            schema: params.schema,
          },
        },
      }),
      cache: "no-store",
    },
    { timeoutMs: llmTotalTimeoutMs(), label: target.model },
  );

  if (!res.ok) throw new Error(await readError(res, target.model));

  const payload = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = payload.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error(`رد JSON فارغ من ${target.model}`);

  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    throw new Error("تعذّر parse رد التحليل المُنظَّم");
  }

  const narrative =
    typeof (data as unknown as { narrative?: unknown }).narrative === "string"
      ? String((data as unknown as { narrative: string }).narrative)
      : "";
  if (narrative && handlers?.onTextDelta) handlers.onTextDelta(narrative);

  return {
    data,
    usage: {
      input_tokens: payload.usage?.prompt_tokens ?? 0,
      output_tokens: payload.usage?.completion_tokens ?? 0,
    },
  };
}

// ---------- model listing ----------

export interface CompatModelInfo {
  id: string;
  display_name: string;
  /** Provider-reported creation time (unix seconds) — the only reliable
   *  "newest" signal; version strings do not sort lexically (…-10 < …-2). */
  created?: number;
}

export async function listOpenAIChatModels(
  apiKey: string,
): Promise<CompatModelInfo[]> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/models",
    {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
    { timeoutMs: httpTimeoutMs(), label: "OpenAI models" },
  );
  if (!res.ok) throw new Error(await readError(res, "OpenAI"));
  const data = (await res.json()) as { data?: { id: string }[] };
  // Keep chat-capable families; drop embeddings/audio/image/moderation models.
  const exclude =
    /embed|whisper|tts|audio|dall-e|image|moderation|babbage|davinci|realtime|transcribe/i;
  const include = /^(gpt-|o[0-9])/i;
  return (data.data ?? [])
    .filter((m) => include.test(m.id) && !exclude.test(m.id))
    .map((m) => ({ id: m.id, display_name: m.id }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

export async function listOpenAIRealtimeModels(
  apiKey: string,
): Promise<CompatModelInfo[]> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/models",
    {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    },
    { timeoutMs: httpTimeoutMs(), label: "OpenAI models" },
  );
  if (!res.ok) throw new Error(await readError(res, "OpenAI"));
  const data = (await res.json()) as { data?: { id: string; created?: number }[] };
  // Keep only models that can host a speech-to-speech session. The
  // transcribe / whisper / translate variants are realtime-named but do a
  // different job, and offering them would silently break the voice agent.
  const include = /realtime/i;
  const exclude = /transcribe|whisper|translate/i;
  return (data.data ?? [])
    .filter((m) => include.test(m.id) && !exclude.test(m.id))
    .map((m) => ({ id: m.id, display_name: m.id, created: m.created }))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || b.id.localeCompare(a.id));
}
