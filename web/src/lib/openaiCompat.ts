/**
 * OpenAI-compatible chat-completions client (OpenAI + Gemini OpenAI-compat).
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

function toOATools(tools?: ToolDef[]) {
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

function fromOAChoice(choice: {
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
  let apiMsg =
    typeof err === "string" ? err : err?.message ? err.message : undefined;

  if (apiMsg && apiMsg.toLowerCase().includes("image_url")) {
    return "النموذج النشط حالياً لا يدعم تحليل صور الشارت. يرجى تعديل خيارات نموذج الذكاء الاصطناعي في لوحة التحكم الإدارية (المفاتيح) وتفعيل نموذج يدعم الرؤية (مثل GPT-4o أو Claude 3.5 Sonnet).";
  }

  return apiMsg || `خطأ من ${label} (HTTP ${res.status})`;
}

// ---------- public API ----------

export async function callOpenAICompat(
  target: OpenAICompatTarget,
  params: {
    system: string;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens?: number;
  },
): Promise<AnthropicResponse> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      "content-type": "application/json",
      ...target.headers,
    },
    body: JSON.stringify({
      model: target.model,
      max_tokens: Math.min(params.maxTokens ?? 4096, 4096),
      messages: toOAMessages(params.system, params.messages),
      ...(params.tools ? { tools: toOATools(params.tools) } : {}),
    }),
    cache: "no-store",
  });

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
  },
  handlers?: StreamHandlers,
): Promise<AnthropicResponse> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      "content-type": "application/json",
      ...target.headers,
    },
    body: JSON.stringify({
      model: target.model,
      max_tokens: Math.min(params.maxTokens ?? 4096, 4096),
      messages: toOAMessages(params.system, params.messages),
      stream: true,
      ...(params.tools ? { tools: toOATools(params.tools) } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(await readError(res, target.model));

  const reader = res.body?.getReader();
  if (!reader) throw new Error(`لا يوجد تدفّق من ${target.model}`);

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

// ---------- model listing ----------

export interface CompatModelInfo {
  id: string;
  display_name: string;
}

export async function listOpenAIChatModels(
  apiKey: string,
): Promise<CompatModelInfo[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
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
