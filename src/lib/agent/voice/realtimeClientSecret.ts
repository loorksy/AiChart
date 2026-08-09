/**
 * Mint a short-lived Realtime client secret (GA `client_secrets` endpoint).
 *
 * SERVER ONLY. The standard API key is used to authenticate this one call and
 * NEVER leaves the server; only the ephemeral `ek_...` client secret is returned
 * to the browser. `fetchImpl` is injectable so unit tests can mock the provider
 * without a real key or network. Tokens are never logged.
 */
import type { VoiceServerConfig } from "./voiceSessionConfig";
import { voiceSystemInstructions } from "./voiceIdentity";
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
  /**
   * Stable privacy-preserving end-user identifier for OpenAI's
   * `OpenAI-Safety-Identifier` header (set only on this server mint call).
   */
  safetyIdentifier?: string;
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

  // Do not put `safety_identifier` in the JSON body — GA rejects that as
  // `unknown_parameter`. OpenAI docs bind it via the request header instead.
  const body = {
    expires_after: { anchor: "created_at", seconds: ttl },
    session: {
      type: "realtime",
      model: config.model,
      instructions: voiceSystemInstructions(locale),
      output_modalities: ["audio"],
      audio: {
        // Disable auto-response from the FIRST moment of the session (the
        // client re-applies this on session.update). The platform agent
        // drives every substantive turn; without this there is a window
        // before the data channel opens where the model could answer alone.
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language: locale === "ar" ? "ar" : "en",
          },
          turn_detection: {
            type: "server_vad",
            create_response: false,
            interrupt_response: true,
          },
        },
        output: { voice: config.voice },
      },
    },
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  if (opts.safetyIdentifier?.trim()) {
    headers["OpenAI-Safety-Identifier"] = opts.safetyIdentifier.trim();
  }

  let res: Response;
  try {
    res = await doFetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers,
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
