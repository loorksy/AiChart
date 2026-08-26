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
  SystemPromptInput,
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
import { isReasoningModel, modelAcceptsVision } from "./modelCatalog";

export interface OpenAICompatTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra optional HTTP headers for the upstream API */
  headers?: Record<string, string>;
  /**
   * Circuit-breaker key. Defaults to "openai" for the OpenAI endpoint.
   */
  resilienceKey?: string;
}

// ---------- request conversion ----------

interface OAToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OAContentPart =
  | { type: "text"; text: string; prompt_cache_breakpoint?: { mode: "explicit" } }
  | {
      type: "image_url";
      image_url: { url: string };
      prompt_cache_breakpoint?: { mode: "explicit" };
    };

interface OAMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OAContentPart[] | null;
  tool_calls?: OAToolCall[];
  tool_call_id?: string;
}

/**
 * GPT-5.6+ supports explicit prompt-cache breakpoints on content blocks
 * (`prompt_cache_breakpoint: {mode:"explicit"}`), and its implicit-only mode
 * bills cache WRITES at 1.25× — placing the implicit breakpoint on a volatile
 * suffix pays for writes that never get a read. Marking the end of the stable
 * prefix explicitly gives the shared prefix a reusable entry. Older models
 * (gpt-4.1 era) are implicit-only: the field would be rejected, so it is only
 * emitted for the families known to accept it.
 */
export function supportsExplicitPromptCache(model: string): boolean {
  const id = bareModelId(model);
  return /^gpt-5\.[6-9]/.test(id) || /^gpt-[6-9]/.test(id);
}

/** Anthropic-style stable-prefix marker → OpenAI explicit breakpoint. */
function oaBreakpoint(
  block: Extract<ContentBlock, { type: "text" | "image" }>,
  explicitCache: boolean,
): { prompt_cache_breakpoint: { mode: "explicit" } } | Record<string, never> {
  return explicitCache && block.cache_control
    ? { prompt_cache_breakpoint: { mode: "explicit" } }
    : {};
}

function blocksToOA(msg: Message, explicitCache: boolean): OAMessage[] {
  if (typeof msg.content === "string") {
    return [{ role: msg.role, content: msg.content }];
  }

  const out: OAMessage[] = [];
  const parts: OAContentPart[] = [];
  const toolCalls: OAToolCall[] = [];
  const toolResults: OAMessage[] = [];

  for (const block of msg.content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text, ...oaBreakpoint(block, explicitCache) });
    } else if (block.type === "image") {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
        ...oaBreakpoint(block, explicitCache),
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

function flattenSystemText(system: SystemPromptInput): string {
  if (typeof system === "string") return system;
  return system.dynamic?.trim()
    ? `${system.static}\n\n${system.dynamic}`
    : system.static;
}

/**
 * Prompt-caching prompt shape: stable prefix first, dynamic tail last.
 *
 * On explicit-cache models the STATIC system text gets its own breakpoint so
 * the shared instructions prefix stays reusable across turns even when the
 * dynamic system tail (lessons, conversation excerpt) changes. On implicit-only
 * models the flattened string keeps the same byte order, which is all
 * automatic prefix caching needs.
 */
function toOAMessages(
  system: SystemPromptInput,
  messages: Message[],
  explicitCache: boolean,
): OAMessage[] {
  const out: OAMessage[] = [];
  if (explicitCache && typeof system !== "string") {
    const parts: OAContentPart[] = [
      {
        type: "text",
        text: system.static,
        prompt_cache_breakpoint: { mode: "explicit" },
      },
    ];
    if (system.dynamic?.trim()) parts.push({ type: "text", text: system.dynamic });
    out.push({ role: "system", content: parts });
  } else {
    out.push({ role: "system", content: flattenSystemText(system) });
  }
  for (const m of messages) out.push(...blocksToOA(m, explicitCache));
  return out;
}

/**
 * Drop image blocks before they hit a text-only model. The platform
 * catalogue is multimodal, so this is a no-op for offered ids; kept so a
 * stray text-only id cannot burn an attempt on a chart PNG.
 */
export function dropUnsupportedVision(model: string, messages: Message[]): Message[] {
  if (modelAcceptsVision(model)) return messages;
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    const kept = m.content.filter((b) => b.type !== "image");
    return kept === m.content ? m : { ...m, content: kept };
  });
}

/** Model id without a vendor prefix (e.g. openai/gpt-4.1 → gpt-4.1). */
function bareModelId(model: string): string {
  const trimmed = model.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Newer OpenAI chat models reject `max_tokens` and require `max_completion_tokens`.
 * Unrecognised ids keep using `max_tokens`, which is also the fallback.
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

function reasoningTokenFloor(_model: string): number {
  return REASONING_MIN_TOKENS;
}

function tokenLimitBody(
  model: string,
  maxTokens?: number,
): Record<string, number> {
  const floor = reasoningTokenFloor(model);
  const limit = isReasoningModel(model)
    ? Math.min(Math.max(maxTokens ?? floor, floor), REASONING_MAX_TOKENS)
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
  // OpenAI-style effort is only valid on o-series / gpt-5.
  const id = bareModelId(model);
  if (/^o\d/.test(id) || /^gpt-5/.test(id)) return { reasoning_effort: "low" };
  return {};
}

// Exported for provider-parity tests: proves any tool (e.g. render_cards)
// converts to the OpenAI-compatible function shape used by openai.
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
    reasoning_content?: string | null;
    tool_calls?: OAToolCall[];
  };
  finish_reason?: string;
}): { content: ContentBlock[]; stop_reason: string } {
  const blocks: ContentBlock[] = [];
  const msg = choice.message;
  // Some reasoning models put the visible answer in `reasoning_content`
  // when `content` is empty or still thinking.
  const text = (msg?.content ?? "").trim() || (msg?.reasoning_content ?? "").trim();

  if (text) {
    blocks.push({ type: "text", text });
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

interface OAUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

/**
 * OpenAI's `prompt_tokens` INCLUDES cached and cache-written tokens, while the
 * platform's unified usage shape (LLMUsage, modeled on Anthropic) counts them
 * separately: input + cache_read + cache_creation = the true total. Normalize
 * here so the usage meter prices both providers with one formula.
 */
function normalizeOAUsage(usage: OAUsage | undefined): AnthropicResponse["usage"] {
  const prompt = usage?.prompt_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const written = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
  return {
    input_tokens: Math.max(0, prompt - cached - written),
    output_tokens: usage?.completion_tokens ?? 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: written,
  };
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
    system: SystemPromptInput;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    /** Caller cancellation/deadline — aborts the in-flight HTTP call. */
    signal?: AbortSignal;
    /** Per-call HTTP budget; falls back to the global LLM timeout. */
    timeoutMs?: number;
    /**
     * `prompt_cache_key` — groups requests that share a prompt prefix so they
     * route to the same cache. A routing hint, never a correctness input;
     * passed through harmlessly by OpenAI-compatible aggregators.
     */
    cacheKey?: string;
  },
): Promise<AnthropicResponse> {
  // Circuit breaker (RELIABILITY_PLAN.md item 6): a provider outage fails fast
  // instead of every request burning its full timeout. No added retries here —
  // callers that retry (the final-decision synthesizer) keep sole ownership of
  // retry policy, so this never double-retries.
  const res = await resilientFetch(
    target.resilienceKey ?? "openai",
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
        messages: toOAMessages(
          params.system,
          dropUnsupportedVision(target.model, params.messages),
          supportsExplicitPromptCache(target.model),
        ),
        ...(params.cacheKey ? { prompt_cache_key: params.cacheKey } : {}),
        ...(params.tools ? { tools: toOATools(params.tools) } : {}),
      }),
      cache: "no-store",
    },
    {
      timeoutMs: params.timeoutMs ?? llmTotalTimeoutMs(),
      label: target.model,
      signal: params.signal,
    },
  );

  if (!res.ok) throw new Error(await readError(res, target.model));

  const data = (await res.json()) as {
    id?: string;
    choices?: Parameters<typeof fromOAChoice>[0][];
    usage?: OAUsage;
  };

  const choice = data.choices?.[0];
  if (!choice) throw new Error(`رد فارغ من ${target.model}`);

  const { content, stop_reason } = fromOAChoice(choice);
  return {
    id: data.id ?? "",
    content,
    stop_reason,
    usage: normalizeOAUsage(data.usage),
  };
}

export async function callOpenAICompatStream(
  target: OpenAICompatTarget,
  params: {
    system: SystemPromptInput;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    /** Caller cancellation/deadline — aborts the in-flight stream. */
    signal?: AbortSignal;
    /** `prompt_cache_key` routing hint — see callOpenAICompat. */
    cacheKey?: string;
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
    system: SystemPromptInput;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
    signal?: AbortSignal;
    cacheKey?: string;
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
      messages: toOAMessages(
        params.system,
        dropUnsupportedVision(target.model, params.messages),
        supportsExplicitPromptCache(target.model),
      ),
      stream: true,
      // Without this the stream carries NO usage chunk at all — streamed
      // calls metered zero tokens and cache hits were invisible.
      stream_options: { include_usage: true },
      ...(params.cacheKey ? { prompt_cache_key: params.cacheKey } : {}),
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
  let reasoning = "";
  // tool calls accumulate by index
  const toolAcc = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  let usage: OAUsage | undefined;

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
            reasoning_content?: string | null;
            tool_calls?: {
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
          finish_reason?: string | null;
        }[];
        usage?: OAUsage;
      };
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }

      if (event.id) messageId = event.id;
      if (event.usage) usage = event.usage;

      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        handlers?.onTextDelta?.(delta.content);
      }
      if (delta?.reasoning_content) {
        reasoning += delta.reasoning_content;
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
  const visible = text.trim() || reasoning.trim();
  if (visible) content.push({ type: "text", text: visible });
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
    usage: normalizeOAUsage(usage),
  };
}

/** Single-pass structured JSON generation (OpenAI Structured Outputs). */
export async function callOpenAICompatStructured<T extends Record<string, unknown>>(
  target: OpenAICompatTarget,
  params: {
    system: SystemPromptInput;
    messages: Message[];
    schemaName: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
    /** `prompt_cache_key` routing hint — see callOpenAICompat. */
    cacheKey?: string;
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
        messages: toOAMessages(
          params.system,
          dropUnsupportedVision(target.model, params.messages),
          supportsExplicitPromptCache(target.model),
        ),
        ...(params.cacheKey ? { prompt_cache_key: params.cacheKey } : {}),
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
    choices?: {
      message?: { content?: string | null; reasoning_content?: string | null };
    }[];
    usage?: OAUsage;
  };
  const msg = payload.choices?.[0]?.message;
  const raw =
    (msg?.content ?? "").trim() || (msg?.reasoning_content ?? "").trim();
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
    usage: normalizeOAUsage(payload.usage),
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
