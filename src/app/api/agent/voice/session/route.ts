import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError, checkRateLimit, clientKey } from "@/lib/api";
import { getChat } from "@/lib/agent/chatHistory/chatStore";
import { newId } from "@/lib/agent/activity";
import { createLogger } from "@/lib/logger";
import {
  getVoiceServerConfig,
  isVoiceConfigured,
} from "@/lib/agent/voice/voiceSessionConfig";
import { parseVoiceSessionRequest } from "@/lib/agent/voice/voiceSessionRequest";
import {
  createRealtimeClientSecret,
  VoiceProviderError,
} from "@/lib/agent/voice/realtimeClientSecret";
import type { VoiceSessionCredential } from "@/lib/agent/voice/types";

function voiceSafetyIdentifier(userId: number): string {
  return createHash("sha256").update(`aichart-voice-user-${userId}`).digest("hex");
}

export const runtime = "nodejs";

const log = createLogger("agent.voice.session");

/**
 * Mint a short-lived Realtime client credential for the browser. The standard
 * OpenAI API key stays on the server — only an ephemeral `ek_...` secret is
 * returned. The user must own `chatId`. Tokens and audio are never logged.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePaidAccess();

    if (!(await isVoiceConfigured())) {
      return NextResponse.json(
        { error: "voice_not_configured" },
        { status: 503 },
      );
    }

    // Rate limit voice-session minting per client (cost + abuse guard).
    if (!checkRateLimit(`voice-session:${user.id}:${clientKey(req)}`, 12, 60_000)) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429 },
      );
    }

    const parsed = parseVoiceSessionRequest(await req.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const { chatId, locale } = parsed.value;

    // Ownership: the voice session is bound to a chat the user owns.
    const chat = await getChat(user.id, chatId);
    if (!chat) {
      return NextResponse.json({ error: "chat_not_found" }, { status: 404 });
    }

    const config = await getVoiceServerConfig();
    const sessionId = newId();

    let minted;
    try {
      minted = await createRealtimeClientSecret({
        config,
        locale,
        safetyIdentifier: voiceSafetyIdentifier(user.id),
      });
    } catch (err) {
      const code = err instanceof VoiceProviderError ? err.code : "provider_unavailable";
      // Log the failure class only — never the key, token, or provider body.
      log.warn("voice.session.mint_failed", { code, userId: user.id });
      return NextResponse.json({ error: code }, { status: 502 });
    }

    const payload: VoiceSessionCredential = {
      clientSecret: minted.clientSecret,
      expiresAt: minted.expiresAt,
      model: minted.model,
      voice: minted.voice,
      sessionId,
      limits: config.limits,
    };

    // Explicit allow-list response: never spread `config` (would leak apiKey).
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return handleError(err);
  }
}
