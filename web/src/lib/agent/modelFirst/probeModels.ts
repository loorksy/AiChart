/**
 * Discover + probe OpenAI models under the configured API key.
 * Never logs API keys or full provider error bodies.
 */
import { fetchWithTimeout, httpTimeoutMs } from "@/lib/externalFetch";
import {
  type ModelCapabilityRecord,
  displayNameForModelId,
  eligibleAsDefaultFromCapabilities,
  inferCostTier,
  isAllowlistedModelId,
  setCachedModelRegistry,
} from "./modelRegistry";
import { callOpenAIResponses, ResponsesApiError } from "./openaiResponses";

async function listProviderModelIds(apiKey: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/models",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    { timeoutMs: httpTimeoutMs(), label: "OpenAI models" },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id?.trim())
    .filter((id): id is string => Boolean(id));
}

async function probeOne(
  apiKey: string,
  modelId: string,
): Promise<ModelCapabilityRecord> {
  const probeErrors: string[] = [];
  let responsesApi = false;
  let vision = false;
  let structuredOutputs = false;
  let reasoning = false;
  let supportedReasoningValues: ModelCapabilityRecord["supportedReasoningValues"] = [];
  const streaming = true;

  try {
    await callOpenAIResponses({
      apiKey,
      model: modelId,
      inputText: 'Reply with JSON only: {"ok":true}',
      maxOutputTokens: 64,
      store: false,
      schema: {
        name: "probe_ok",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
        strict: true,
      },
      timeoutMs: 45_000,
    });
    responsesApi = true;
    structuredOutputs = true;
  } catch (err) {
    probeErrors.push(
      err instanceof ResponsesApiError ? err.code : "structured_probe_failed",
    );
  }

  if (responsesApi) {
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    try {
      await callOpenAIResponses({
        apiKey,
        model: modelId,
        inputText: 'Looking at the image, reply JSON {"ok":true}',
        images: [{ mediaType: "image/png", base64: tinyPng, detail: "low" }],
        maxOutputTokens: 64,
        store: false,
        schema: {
          name: "probe_vision",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
          strict: true,
        },
        timeoutMs: 60_000,
      });
      vision = true;
    } catch (err) {
      probeErrors.push(
        err instanceof ResponsesApiError ? err.code : "vision_probe_failed",
      );
    }
  }

  if (responsesApi) {
    const found: ModelCapabilityRecord["supportedReasoningValues"] = [];
    for (const effort of ["high", "medium", "low"] as const) {
      try {
        await callOpenAIResponses({
          apiKey,
          model: modelId,
          inputText: 'Reply JSON {"ok":true}',
          reasoningEffort: effort,
          maxOutputTokens: 64,
          store: false,
          schema: {
            name: "probe_reason",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
            },
            strict: true,
          },
          timeoutMs: 60_000,
        });
        found.push(effort);
      } catch {
        /* unsupported */
      }
    }
    supportedReasoningValues = found;
    reasoning = found.length > 0;
  }

  const base: ModelCapabilityRecord = {
    id: modelId,
    displayName: displayNameForModelId(modelId),
    available: responsesApi && structuredOutputs && vision,
    enabled: true,
    responsesApi,
    vision,
    structuredOutputs,
    reasoning,
    supportedReasoningValues,
    streaming,
    tools: true,
    contextTokens: null,
    deprecated: false,
    costTier: inferCostTier(modelId),
    eligibleAsDefault: false,
    lastVerifiedAt: Date.now(),
    probeErrors,
  };
  base.eligibleAsDefault = eligibleAsDefaultFromCapabilities(base);
  return base;
}

export async function discoverAndProbeModels(apiKey: string): Promise<ModelCapabilityRecord[]> {
  const ids = await listProviderModelIds(apiKey);
  const candidates = [...new Set(ids.map((id) => id.replace(/^openai\//, "")))]
    .filter(isAllowlistedModelId)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 12);

  const records: ModelCapabilityRecord[] = [];
  for (const id of candidates) {
    records.push(await probeOne(apiKey, id));
  }

  records.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.eligibleAsDefault !== b.eligibleAsDefault) return a.eligibleAsDefault ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  setCachedModelRegistry(records);
  return records;
}

/** Test stub without network — assumes full capabilities for allowlisted IDs. */
export function stubProbedRegistry(ids: string[]): ModelCapabilityRecord[] {
  const records = ids.filter(isAllowlistedModelId).map((id) => {
    const supportedReasoningValues: ModelCapabilityRecord["supportedReasoningValues"] =
      /gpt-5|o3|o4/i.test(id) ? ["high", "medium", "low"] : [];
    const base: ModelCapabilityRecord = {
      id,
      displayName: displayNameForModelId(id),
      available: true,
      enabled: true,
      responsesApi: true,
      vision: true,
      structuredOutputs: true,
      reasoning: supportedReasoningValues.length > 0,
      supportedReasoningValues,
      streaming: true,
      tools: true,
      contextTokens: 128_000,
      deprecated: false,
      costTier: inferCostTier(id),
      eligibleAsDefault: false,
      lastVerifiedAt: Date.now(),
      probeErrors: [],
    };
    base.eligibleAsDefault = eligibleAsDefaultFromCapabilities(base);
    return base;
  });
  setCachedModelRegistry(records);
  return records;
}
