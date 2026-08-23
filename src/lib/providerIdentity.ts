/**
 * Provider identity — the pure half of the LLM layer.
 *
 * Who the providers ARE (ids, display names) and which provider a thrown
 * failure belongs to. No keys, no config, no clients, no node builtins: a
 * client component rendering a failure needs to name the provider, and the
 * moment that vocabulary lives next to the API clients, the browser bundle
 * reaches the whole server layer to read one label.
 *
 * lib/llm.ts owns the DECISION (which provider answers). This module owns
 * only the NAMES, so both sides of the app can speak about the same two
 * providers without sharing a runtime.
 */

export type LLMProvider = "openai" | "anthropic";

export const LLM_PROVIDERS: { id: LLMProvider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
];

/** Display name for the operator-facing surfaces (panel, refusals, logs). */
export function providerLabel(provider: LLMProvider): string {
  return LLM_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function isLLMProvider(value: unknown): value is LLMProvider {
  return value === "openai" || value === "anthropic";
}

/**
 * Which provider a thrown LLM failure belongs to.
 *
 * The property rides on the error object itself so it survives every rethrow
 * between the HTTP client and the taxonomy that words the message — and so a
 * failure can say "OpenAI is out of credit" instead of "the AI provider is",
 * which is what sent an operator to top up the account that was working.
 */
const PROVIDER_TAG = "lonoraProvider";

export function tagProviderFailure(err: unknown, provider: LLMProvider): unknown {
  if (err && typeof err === "object" && !(PROVIDER_TAG in err)) {
    try {
      Object.defineProperty(err, PROVIDER_TAG, {
        value: provider,
        enumerable: false,
        configurable: true,
      });
    } catch {
      /* frozen error object — the message still carries the failure */
    }
  }
  return err;
}

export function providerOfFailure(err: unknown): LLMProvider | null {
  if (err && typeof err === "object" && PROVIDER_TAG in err) {
    const v = (err as Record<string, unknown>)[PROVIDER_TAG];
    if (isLLMProvider(v)) return v;
  }
  return null;
}
