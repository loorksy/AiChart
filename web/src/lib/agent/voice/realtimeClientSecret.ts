/**
 * Mint a short-lived Realtime client secret (GA `client_secrets` endpoint).
 *
 * SERVER ONLY. The standard API key is used to authenticate this one call and
 * NEVER leaves the server; only the ephemeral `ek_...` client secret is returned
 * to the browser. `fetchImpl` is injectable so unit tests can mock the provider
 * without a real key or network. Tokens are never logged.
 */
import type { VoiceServerConfig } from "./voiceSessionConfig";
import { voiceSystemInstructions } from "./voiceSessionInstructions";
import type { AppLocale } from "@/lib/i18n";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

export interface MintedClientSecret {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
}

export interface MintOptions {
  config: VoiceServerConfig;
  locale: AppLocale;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
}

/** Shape we read from the provider response (only the fields we need). */
interface ClientSecretResponse {
  value?: string;
  client_secret?: { value?: string; expires_at?: number };
  expires_at?: number;
}

export async function createRealtimeClientSecret(
  opts: MintOptions,
): Promise<MintedClientSecret> {
  const { config, locale } = opts;
  const ttl = Math.max(60, Math.min(opts.ttlSeconds ?? 600, 3600));
  const doFetch = opts.fetchImpl ?? fetch;

  // Note: the GA `client_secrets` endpoint does NOT accept a `safety_identifier`
  // — it rejects the request with 400 `unknown_parameter` whether the field is
  // nested under `session` or placed at the top level. So we do not send one. If
  // OpenAI adds support later, re-introduce it here.
  const body = {
    expires_after: { anchor: "created_at", seconds: ttl },
    session: {
      type: "realtime",
      model: config.model,
      instructions: voiceSystemInstructions(locale),
      audio: { output: { voice: config.voice } },
    },
  };

  let res: Response;
  try {
    res = await doFetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new VoiceProviderError("provider_unavailable");
  }

  if (!res.ok) {
    // Never surface the provider's raw error body (may echo request content).
    throw new VoiceProviderError(
      res.status === 401 || res.status === 403 ? "credential_failed" : "provider_unavailable",
    );
  }

  let json: ClientSecretResponse;
  try {
    json = (await res.json()) as ClientSecretResponse;
  } catch {
    throw new VoiceProviderError("provider_unavailable");
  }

  const clientSecret = json.value ?? json.client_secret?.value;
  if (!clientSecret) throw new VoiceProviderError("credential_failed");

  const expiresAt =
    (json.expires_at ?? json.client_secret?.expires_at ?? 0) * 1000 ||
    Date.now() + ttl * 1000;

  return { clientSecret, expiresAt, model: config.model, voice: config.voice };
}

export class VoiceProviderError extends Error {
  constructor(public readonly code: "credential_failed" | "provider_unavailable") {
    super(code);
    this.name = "VoiceProviderError";
  }
}
