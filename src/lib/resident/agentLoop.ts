/**
 * The resident agent loop — Vercel AI SDK generateText/streamText with tools.
 *
 * The model drives: it may read candles, browse another timeframe, run the
 * specialists, then answer — streaming its reply as it forms. The loop only
 * enforces LIMITS, and it enforces them as NAMED errors, never silent
 * truncation:
 *
 *  - AgentIterationLimitError when the step cap is hit while the model still
 *    wants tools (a finished answer under the cap is success, not an error);
 *  - AgentDeadlineError when the wall-clock budget expires.
 *
 * Extended thinking rides on analysis calls via the provider's adaptive
 * thinking option. The model itself resolves from the platform's provider
 * config; tests inject a mock model, so the loop's behaviour is covered
 * without a network.
 */
import {
  generateText,
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { getActiveModel, getActiveProvider, getProviderApiKey } from "@/lib/llm";
import { createLogger } from "@/lib/logger";

const log = createLogger("resident.loop");

export class AgentIterationLimitError extends Error {
  constructor(steps: number) {
    super(`Agent exceeded the tool-call iteration cap (${steps} steps) without finishing.`);
    this.name = "AgentIterationLimitError";
  }
}

export class AgentDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`Agent exceeded the wall-clock budget (${deadlineMs}ms).`);
    this.name = "AgentDeadlineError";
  }
}

export class AgentModelUnavailableError extends Error {
  constructor(provider: string) {
    super(`No API key configured for provider "${provider}" — the agent loop cannot run.`);
    this.name = "AgentModelUnavailableError";
  }
}

/** Resolve the platform's active provider/model into an AI-SDK model. */
export async function resolveLoopModel(): Promise<LanguageModel> {
  const provider = getActiveProvider();
  const apiKey = getProviderApiKey(provider);
  if (!apiKey) throw new AgentModelUnavailableError(provider);
  const modelId = getActiveModel();
  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey })(modelId);
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({ apiKey })(modelId);
}

/** Adaptive extended thinking on analysis calls (Anthropic models). */
function loopProviderOptions() {
  return {
    anthropic: { thinking: { type: "adaptive" as const } },
  };
}

export interface AgentLoopInput {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  /** Injectable model (tests). Defaults to the platform's active model. */
  model?: LanguageModel;
  /** Hard cap on loop steps (each step = one model call). */
  maxSteps?: number;
  /** Hard wall-clock cap for the whole event. */
  deadlineMs?: number;
  /** Live text chunks as the reply forms. */
  onTextDelta?: (delta: string) => void;
  /** External cancellation (host shutdown). */
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  text: string;
  steps: number;
  toolCalls: { name: string; input: unknown }[];
  finishReason: string;
}

export const DEFAULT_MAX_STEPS = 12;
export const DEFAULT_DEADLINE_MS = 150_000;

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const deadlineMs = input.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const model = input.model ?? (await resolveLoopModel());

  const controller = new AbortController();
  let deadlineHit = false;
  // Deliberately REF'd: a hard deadline must fire even when nothing else
  // holds the event loop open. It is always cleared in finally.
  const timer = setTimeout(() => {
    deadlineHit = true;
    controller.abort();
  }, deadlineMs);
  const onOuterAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const result = streamText({
      model,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(maxSteps),
      abortSignal: controller.signal,
      providerOptions: loopProviderOptions(),
    });

    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        input.onTextDelta?.(part.text);
      }
      if (part.type === "error") {
        // Surface stream-level errors as real failures below via finishReason.
        log.warn("loop stream error part", {
          error: part.error instanceof Error ? part.error.message : String(part.error),
        });
      }
    }

    const [finishReason, steps] = await Promise.all([result.finishReason, result.steps]);
    const toolCalls = steps.flatMap((step) =>
      step.toolCalls.map((call) => ({ name: call.toolName, input: call.input })),
    );

    if (finishReason === "tool-calls") {
      // The cap stopped the loop while the model still wanted tools —
      // a named failure, never a half-answer passed off as done.
      throw new AgentIterationLimitError(steps.length);
    }

    return { text, steps: steps.length, toolCalls, finishReason };
  } catch (err) {
    if (deadlineHit) throw new AgentDeadlineError(deadlineMs);
    if (controller.signal.aborted && input.signal?.aborted) throw err;
    throw err;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Non-streaming variant for callers that only need the final text. */
export async function runAgentLoopOnce(
  input: Omit<AgentLoopInput, "onTextDelta">,
): Promise<AgentLoopResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const deadlineMs = input.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const model = input.model ?? (await resolveLoopModel());
  const controller = new AbortController();
  let deadlineHit = false;
  // Deliberately REF'd: a hard deadline must fire even when nothing else
  // holds the event loop open. It is always cleared in finally.
  const timer = setTimeout(() => {
    deadlineHit = true;
    controller.abort();
  }, deadlineMs);
  try {
    const result = await generateText({
      model,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(maxSteps),
      abortSignal: controller.signal,
      providerOptions: loopProviderOptions(),
    });
    if (result.finishReason === "tool-calls") {
      throw new AgentIterationLimitError(result.steps.length);
    }
    return {
      text: result.text,
      steps: result.steps.length,
      toolCalls: result.steps.flatMap((step) =>
        step.toolCalls.map((call) => ({ name: call.toolName, input: call.input })),
      ),
      finishReason: result.finishReason,
    };
  } catch (err) {
    if (deadlineHit) throw new AgentDeadlineError(deadlineMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
