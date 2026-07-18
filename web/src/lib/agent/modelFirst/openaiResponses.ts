/**
 * Canonical OpenAI Responses API adapter for trading analysis.
 * Always uses store: false unless an approved retention policy overrides.
 */
import {
  ExternalTimeoutError,
  fetchWithTimeout,
  llmTotalTimeoutMs,
} from "@/lib/externalFetch";
import type { ReasoningEffort } from "./modelRegistry";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export type ResponsesImageDetail = "high" | "low" | "auto";

export interface ResponsesImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
  detail?: ResponsesImageDetail;
}

export interface ResponsesStructuredSchema {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface CallResponsesParams {
  apiKey: string;
  model: string;
  instructions?: string;
  inputText: string;
  images?: ResponsesImageInput[];
  reasoningEffort?: ReasoningEffort | null;
  maxOutputTokens?: number;
  schema?: ResponsesStructuredSchema;
  /** Must remain false for trading analysis (default). */
  store?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CallResponsesResult {
  text: string;
  responseId: string | null;
  model: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  rawStatus: number;
}

export class ResponsesApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unauthorized"
      | "rate_limited"
      | "timeout"
      | "invalid_request"
      | "provider_error"
      | "empty_response",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ResponsesApiError";
  }
}

function buildInput(params: CallResponsesParams): unknown[] {
  const content: unknown[] = [{ type: "input_text", text: params.inputText }];
  for (const image of params.images ?? []) {
    content.push({
      type: "input_image",
      image_url: `data:${image.mediaType};base64,${image.base64}`,
      detail: image.detail ?? "auto",
    });
  }
  return [{ role: "user", content }];
}

function extractOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = payload.output;
  if (!Array.isArray(output)) return "";
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: string };
      if ((p.type === "output_text" || p.type === "text") && typeof p.text === "string") {
        chunks.push(p.text);
      }
    }
  }
  return chunks.join("").trim();
}

/**
 * Canonical trading Responses call. Forces store:false unless caller
 * explicitly passes store:true under an approved retention policy.
 */
export async function callOpenAIResponses(
  params: CallResponsesParams,
): Promise<CallResponsesResult> {
  const store = params.store === true ? true : false;
  const body: Record<string, unknown> = {
    model: params.model,
    store,
    input: buildInput(params),
    max_output_tokens: Math.min(params.maxOutputTokens ?? 4096, 8192),
  };
  if (params.instructions?.trim()) {
    body.instructions = params.instructions.trim();
  }
  if (params.reasoningEffort) {
    body.reasoning = { effort: params.reasoningEffort };
  }
  if (params.schema) {
    body.text = {
      format: {
        type: "json_schema",
        name: params.schema.name,
        schema: params.schema.schema,
        strict: params.schema.strict ?? true,
      },
    };
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(
      RESPONSES_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
      {
        timeoutMs: params.timeoutMs ?? llmTotalTimeoutMs(),
        label: "OpenAI Responses",
      },
    );
  } catch (err) {
    if (err instanceof ExternalTimeoutError) {
      throw new ResponsesApiError("responses_timeout", "timeout");
    }
    throw new ResponsesApiError("responses_network", "provider_error");
  }

  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ResponsesApiError("responses_unauthorized", "unauthorized", res.status);
    }
    if (res.status === 429) {
      throw new ResponsesApiError("responses_rate_limited", "rate_limited", res.status);
    }
    if (res.status === 400) {
      throw new ResponsesApiError("responses_invalid_request", "invalid_request", res.status);
    }
    throw new ResponsesApiError("responses_provider_error", "provider_error", res.status);
  }

  const text = extractOutputText(json);
  if (!text) {
    throw new ResponsesApiError("responses_empty", "empty_response", res.status);
  }

  const usage = (json.usage ?? {}) as Record<string, unknown>;
  return {
    text,
    responseId: typeof json.id === "string" ? json.id : null,
    model: typeof json.model === "string" ? json.model : params.model,
    usage: {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
      totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
    },
    rawStatus: res.status,
  };
}

/** Test helper: build the request body shape without network I/O. */
export function buildTradingResponsesBody(
  params: Omit<CallResponsesParams, "apiKey" | "signal" | "timeoutMs">,
): Record<string, unknown> {
  const store = params.store === true ? true : false;
  const body: Record<string, unknown> = {
    model: params.model,
    store,
    input: buildInput(params as CallResponsesParams),
  };
  if (params.reasoningEffort) {
    body.reasoning = { effort: params.reasoningEffort };
  }
  return body;
}
