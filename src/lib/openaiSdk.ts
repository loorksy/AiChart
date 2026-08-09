import OpenAI from "openai";
import type { Message, StreamHandlers } from "@/lib/anthropic";
import {
  openAICompatTokenLimitField,
  type OpenAICompatTarget,
} from "@/lib/openaiCompat";
import { llmTotalTimeoutMs } from "@/lib/externalFetch";

type OAPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function toSdkMessages(
  system: string,
  messages: Message[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
      continue;
    }
    const parts: OAPart[] = [];
    for (const block of m.content) {
      if (block.type === "text") parts.push({ type: "text", text: block.text });
      else if (block.type === "image") {
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        });
      }
    }
    if (parts.length > 0) {
      out.push({
        role: "user",
        content: parts as OpenAI.Chat.ChatCompletionContentPart[],
      });
    }
  }
  return out;
}

/**
 * Structured JSON-schema chat call via the official OpenAI SDK.
 * Mirrors callOpenAICompatStructured's contract (data + usage).
 */
export async function callOpenAISdkStructured<T extends Record<string, unknown>>(
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
  const client = new OpenAI({
    apiKey: target.apiKey,
    baseURL: target.baseUrl,
    timeout: llmTotalTimeoutMs(),
    maxRetries: 1,
  });

  const tokenField = openAICompatTokenLimitField(target.model);
  const limit = params.maxTokens ?? 8192;

  const completion = await client.chat.completions.create({
    model: target.model,
    messages: toSdkMessages(params.system, params.messages),
    ...(tokenField === "max_completion_tokens"
      ? { max_completion_tokens: limit }
      : { max_tokens: limit }),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: params.schemaName,
        strict: true,
        schema: params.schema,
      },
    },
  });

  const raw = completion.choices?.[0]?.message?.content?.trim();
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
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}
