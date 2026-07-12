import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRealtimeClientSecret,
  VoiceProviderError,
} from "@/lib/agent/voice/realtimeClientSecret";
import type { VoiceServerConfig } from "@/lib/agent/voice/voiceSessionConfig";

const config: VoiceServerConfig = {
  apiKey: "sk-standard-secret",
  model: "gpt-realtime",
  voice: "alloy",
  limits: { maxMinutes: 10, idleTimeoutSeconds: 45, maxReconnectAttempts: 3 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("createRealtimeClientSecret", () => {
  it("returns only the short-lived client secret (never the API key)", async () => {
    let sentAuth: string | undefined;
    let sentBody: string | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentAuth = (init?.headers as Record<string, string>)?.Authorization;
      sentBody = init?.body as string;
      return jsonResponse({ value: "ek_ephemeral_123", expires_at: 1_000 });
    }) as unknown as typeof fetch;

    const minted = await createRealtimeClientSecret({
      config,
      locale: "ar",
      fetchImpl,
    });

    assert.equal(minted.clientSecret, "ek_ephemeral_123");
    assert.equal(minted.model, "gpt-realtime");
    assert.equal(minted.expiresAt, 1_000_000); // seconds → ms
    // The standard key is used as Bearer for the call…
    assert.equal(sentAuth, "Bearer sk-standard-secret");
    // …but never appears in the returned object.
    assert.ok(!JSON.stringify(minted).includes("sk-standard-secret"));
    // Regression guard: the GA client_secrets endpoint rejects
    // `safety_identifier` (400 unknown_parameter), so we must never send one.
    assert.ok(!sentBody!.includes("safety_identifier"));
  });

  it("maps 401 to a credential error", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "bad key" }, 401)) as unknown as typeof fetch;
    await assert.rejects(
      createRealtimeClientSecret({ config, locale: "en", fetchImpl }),
      (e: unknown) => e instanceof VoiceProviderError && e.code === "credential_failed",
    );
  });

  it("maps a network throw to provider_unavailable", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await assert.rejects(
      createRealtimeClientSecret({ config, locale: "en", fetchImpl }),
      (e: unknown) => e instanceof VoiceProviderError && e.code === "provider_unavailable",
    );
  });

  it("rejects a response with no client secret", async () => {
    const fetchImpl = (async () => jsonResponse({ nothing: true })) as unknown as typeof fetch;
    await assert.rejects(
      createRealtimeClientSecret({ config, locale: "en", fetchImpl }),
      (e: unknown) => e instanceof VoiceProviderError && e.code === "credential_failed",
    );
  });
});
