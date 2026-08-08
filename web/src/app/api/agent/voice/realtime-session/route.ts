import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError, checkRateLimit, clientKey } from "@/lib/api";
import { getChat } from "@/lib/agent/chatHistory/chatStore";
import { createLogger } from "@/lib/logger";
import {
  getVoiceServerConfig,
  isVoiceConfigured,
} from "@/lib/agent/voice/voiceSessionConfig";
import { voiceBridgeInstructions } from "@/lib/agent/voice/voiceBridgeInstructions";
import type { AppLocale } from "@/lib/i18n";

export const runtime = "nodejs";

const log = createLogger("agent.voice.realtime-session");
const OPENAI_REALTIME_CALLS = "https://api.openai.com/v1/realtime/calls";

function voiceSafetyIdentifier(userId: number): string {
  return createHash("sha256").update(`aichart-voice-user-${userId}`).digest("hex");
}

function parseLocale(raw: string | null): AppLocale {
  return raw === "en" ? "en" : "ar";
}

/**
 * Official OpenAI realtime-voice-component auth: browser POSTs multipart
 * (sdp + session), server proxies to /v1/realtime/calls with the API key.
 * Never expose the standard API key to the browser.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePaidAccess();

    if (!(await isVoiceConfigured())) {
      return NextResponse.json({ error: "voice_not_configured" }, { status: 503 });
    }

    if (!checkRateLimit(`voice-realtime:${user.id}:${clientKey(req)}`, 12, 60_000)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const chatId = req.nextUrl.searchParams.get("chatId")?.trim() ?? "";
    const locale = parseLocale(req.nextUrl.searchParams.get("locale"));
    if (!chatId || chatId.length > 64) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const chat = await getChat(user.id, chatId, "lonora");
    if (!chat) {
      return NextResponse.json({ error: "chat_not_found" }, { status: 404 });
    }

    const formData = await req.formData();
    const sdp = formData.get("sdp");
    const sessionField = formData.get("session");
    if (typeof sdp !== "string" || !sdp.trim()) {
      return NextResponse.json({ error: "invalid_sdp" }, { status: 400 });
    }
    if (typeof sessionField !== "string" || !sessionField.trim()) {
      return NextResponse.json({ error: "invalid_session" }, { status: 400 });
    }

    let session: Record<string, unknown>;
    try {
      session = JSON.parse(sessionField) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_session" }, { status: 400 });
    }

    const config = await getVoiceServerConfig();
    const audio =
      session.audio && typeof session.audio === "object"
        ? { ...(session.audio as Record<string, unknown>) }
        : {};
    const output =
      audio.output && typeof audio.output === "object"
        ? { ...(audio.output as Record<string, unknown>) }
        : {};
    const input =
      audio.input && typeof audio.input === "object"
        ? { ...(audio.input as Record<string, unknown>) }
        : {};

    // Server owns model/voice/instructions — client tools stay as sent.
    session.model = config.model;
    session.instructions = voiceBridgeInstructions(locale);
    session.audio = {
      ...audio,
      input: {
        ...input,
        transcription: {
          model: "gpt-4o-mini-transcribe",
          language: locale === "ar" ? "ar" : "en",
          ...(typeof input.transcription === "object" && input.transcription
            ? (input.transcription as Record<string, unknown>)
            : {}),
        },
      },
      output: { ...output, voice: config.voice },
    };

    const outbound = new FormData();
    outbound.set("sdp", sdp);
    outbound.set("session", JSON.stringify(session));

    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      "OpenAI-Safety-Identifier": voiceSafetyIdentifier(user.id),
    };

    let openaiRes: Response;
    try {
      openaiRes = await fetch(OPENAI_REALTIME_CALLS, {
        method: "POST",
        headers,
        body: outbound,
      });
    } catch {
      log.warn("voice.realtime_session.proxy_failed", { userId: user.id });
      return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
    }

    const answer = await openaiRes.text();
    if (!openaiRes.ok) {
      log.warn("voice.realtime_session.openai_rejected", {
        userId: user.id,
        status: openaiRes.status,
      });
      return NextResponse.json(
        { error: openaiRes.status === 401 || openaiRes.status === 403 ? "credential_failed" : "provider_unavailable" },
        { status: 502 },
      );
    }

    return new NextResponse(answer, {
      status: 200,
      headers: {
        "Content-Type":
          openaiRes.headers.get("content-type") ?? "application/sdp; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
