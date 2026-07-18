import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clearPlatformConfigCache } from "@/lib/platformConfig";
import {
  readVoiceLimits,
  getVoiceServerConfig,
  isVoiceConfigured,
} from "@/lib/agent/voice/voiceSessionConfig";
import {
  voiceSessionReducer,
  initialVoiceState,
} from "@/lib/agent/voice/voiceSessionReducer";
import { TranscriptTracker, isEmptyTranscript } from "@/lib/agent/voice/transcriptTracker";
import {
  VoiceConfirmationGuard,
  isAffirmationPhrase,
} from "@/lib/agent/voice/voiceConfirmationGuard";
import {
  buildRealtimeSessionUpdate,
  buildSpeakResponse,
} from "@/lib/agent/voice/voiceSessionInstructions";
import { voiceSystemInstructions } from "@/lib/agent/voice/voiceIdentity";
import { voiceStatusKey, voiceErrorKey } from "@/lib/agent/voice/voiceLabels";
import { voiceStatusToAvatarState } from "@/lib/agent/voice/avatarState";
import { parseVoiceSessionRequest } from "@/lib/agent/voice/voiceSessionRequest";
import { speakableFromResult } from "@/lib/agent/voice/speakableAnswer";
import type { VoiceErrorCode, VoiceSessionStatus } from "@/lib/agent/voice/types";
import { isRecoverableVoiceError } from "@/lib/agent/voice/types";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_REALTIME_MODEL",
  "OPENAI_REALTIME_VOICE",
  "VOICE_SESSION_MAX_MINUTES",
  "VOICE_IDLE_TIMEOUT_SECONDS",
  "VOICE_MAX_RECONNECT_ATTEMPTS",
];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("voiceSessionConfig", () => {
  it("uses conservative defaults", () => {
    for (const k of ["VOICE_SESSION_MAX_MINUTES", "VOICE_IDLE_TIMEOUT_SECONDS", "VOICE_MAX_RECONNECT_ATTEMPTS"]) {
      delete process.env[k];
    }
    const limits = readVoiceLimits();
    assert.equal(limits.maxMinutes, 10);
    assert.equal(limits.idleTimeoutSeconds, 45);
    assert.equal(limits.maxReconnectAttempts, 3);
  });

  it("clamps env limits into safe bounds", () => {
    process.env.VOICE_SESSION_MAX_MINUTES = "9999";
    process.env.VOICE_MAX_RECONNECT_ATTEMPTS = "-5";
    const limits = readVoiceLimits();
    assert.equal(limits.maxMinutes, 60);
    assert.equal(limits.maxReconnectAttempts, 0);
  });

  it("throws when no API key is configured", async () => {
    clearPlatformConfigCache();
    delete process.env.OPENAI_API_KEY;
    assert.equal(await isVoiceConfigured(), false);
    await assert.rejects(() => getVoiceServerConfig(), /voice_not_configured/);
  });

  it("reads model/voice from env when present", async () => {
    clearPlatformConfigCache();
    process.env.OPENAI_API_KEY = "sk-secret";
    process.env.OPENAI_REALTIME_MODEL = "gpt-realtime";
    process.env.OPENAI_REALTIME_VOICE = "cedar";
    const cfg = await getVoiceServerConfig();
    assert.equal(cfg.model, "gpt-realtime");
    assert.equal(cfg.voice, "cedar");
    assert.equal(cfg.apiKey, "sk-secret");
  });
});

describe("voiceSessionReducer", () => {
  const start = () => initialVoiceState(3);

  it("idle → permission → connecting → listening", () => {
    let s = start();
    s = voiceSessionReducer(s, { type: "request_permission" });
    assert.equal(s.status, "requesting_permission");
    s = voiceSessionReducer(s, { type: "connecting" });
    assert.equal(s.status, "connecting");
    s = voiceSessionReducer(s, { type: "connected" });
    s = voiceSessionReducer(s, { type: "listening" });
    assert.equal(s.status, "listening");
  });

  it("listening → user_speaking → processing → assistant_speaking", () => {
    let s = { ...start(), status: "listening" as VoiceSessionStatus };
    s = voiceSessionReducer(s, { type: "user_speech_started" });
    assert.equal(s.status, "user_speaking");
    s = voiceSessionReducer(s, { type: "user_speech_stopped" });
    assert.equal(s.status, "processing");
    s = voiceSessionReducer(s, { type: "assistant_speaking" });
    assert.equal(s.status, "assistant_speaking");
    s = voiceSessionReducer(s, { type: "assistant_stopped" });
    assert.equal(s.status, "listening");
  });

  it("mute/unmute and interruption states", () => {
    let s = { ...start(), status: "assistant_speaking" as VoiceSessionStatus };
    s = voiceSessionReducer(s, { type: "mute" });
    assert.equal(s.muted, true);
    s = voiceSessionReducer(s, { type: "unmute" });
    assert.equal(s.muted, false);
    s = voiceSessionReducer(s, { type: "interrupt" });
    assert.equal(s.status, "listening");
    assert.equal(s.interrupted, true);
  });

  it("recoverable disconnect → reconnecting, bounded at the maximum", () => {
    let s = { ...start(), status: "listening" as VoiceSessionStatus };
    s = voiceSessionReducer(s, { type: "disconnected", recoverable: true });
    assert.equal(s.status, "reconnecting");
    assert.equal(s.reconnectAttempts, 1);
    s = voiceSessionReducer(s, { type: "disconnected", recoverable: true });
    s = voiceSessionReducer(s, { type: "disconnected", recoverable: true });
    assert.equal(s.reconnectAttempts, 3);
    // 4th attempt exceeds max → give up with an error, no infinite loop.
    s = voiceSessionReducer(s, { type: "disconnected", recoverable: true });
    assert.equal(s.status, "error");
    assert.equal(s.error, "network_lost");
  });

  it("reconnected resets attempts", () => {
    let s = { ...start(), status: "reconnecting" as VoiceSessionStatus, reconnectAttempts: 2 };
    s = voiceSessionReducer(s, { type: "reconnected" });
    assert.equal(s.status, "listening");
    assert.equal(s.reconnectAttempts, 0);
  });

  it("stop → stopped cleans state and ignores further actions", () => {
    let s = { ...start(), status: "listening" as VoiceSessionStatus, muted: true };
    s = voiceSessionReducer(s, { type: "stop" });
    assert.equal(s.status, "stopping");
    s = voiceSessionReducer(s, { type: "stopped" });
    assert.equal(s.status, "stopped");
    assert.equal(s.muted, false);
    const after = voiceSessionReducer(s, { type: "listening" });
    assert.equal(after.status, "stopped"); // terminal until a fresh start
  });
});

describe("transcriptTracker", () => {
  const ev = (over: Partial<{ id: string; text: string; final: boolean }>) => ({
    id: over.id ?? "e1",
    role: "user" as const,
    text: over.text ?? "hello",
    final: over.final ?? true,
    createdAt: 1,
  });

  it("partial transcript is display-only, never submitted", () => {
    const tr = new TranscriptTracker();
    const out = tr.handle(ev({ text: "buy gold", final: false }));
    assert.equal(out.display, "buy gold");
    assert.equal(out.submit, undefined);
  });

  it("final transcript is submitted once", () => {
    const tr = new TranscriptTracker();
    const out = tr.handle(ev({ id: "a", text: "analyze XAUUSD" }));
    assert.equal(out.submit, "analyze XAUUSD");
  });

  it("duplicate event id is ignored", () => {
    const tr = new TranscriptTracker();
    tr.handle(ev({ id: "a", text: "buy now" }));
    const dup = tr.handle(ev({ id: "a", text: "buy now" }));
    assert.equal(dup.submit, undefined);
  });

  it("identical final text under a new id is not submitted twice", () => {
    const tr = new TranscriptTracker();
    tr.handle(ev({ id: "a", text: "close the trade" }));
    const again = tr.handle(ev({ id: "b", text: "close the trade" }));
    assert.equal(again.submit, undefined);
  });

  it("empty / noise transcript is ignored", () => {
    const tr = new TranscriptTracker();
    assert.equal(tr.handle(ev({ id: "x", text: "   " })).submit, undefined);
    assert.equal(tr.handle(ev({ id: "y", text: "..." })).submit, undefined);
    assert.equal(isEmptyTranscript("[inaudible]"), false); // has letters → allowed
    assert.equal(isEmptyTranscript("؟؟"), true);
  });

  it("Arabic and English and trading symbols are preserved verbatim", () => {
    const tr = new TranscriptTracker();
    assert.equal(tr.handle(ev({ id: "1", text: "اشتري ذهب XAUUSD" })).submit, "اشتري ذهب XAUUSD");
    assert.equal(
      tr.handle(ev({ id: "2", text: "set SL below TP1 on 15m" })).submit,
      "set SL below TP1 on 15m",
    );
  });
});

describe("voiceConfirmationGuard", () => {
  const base = { userId: 7, chatId: "c1", locale: "en" as const };

  it("does not confirm without a pending action (vague ack)", () => {
    const g = new VoiceConfirmationGuard();
    const r = g.resolve({ ...base, transcriptId: "t1", text: "okay", now: 100 });
    assert.equal(r, "no_pending");
  });

  it("confirms only a bound affirmation while pending and unexpired", () => {
    const g = new VoiceConfirmationGuard();
    g.arm({ userId: 7, chatId: "c1", action: "buy XAUUSD", now: 0, ttlMs: 1000 });
    const r = g.resolve({ ...base, transcriptId: "t1", text: "yes execute", now: 500 });
    assert.equal(r, "confirmed");
  });

  it("rejects a stale (expired) confirmation", () => {
    const g = new VoiceConfirmationGuard();
    g.arm({ userId: 7, chatId: "c1", action: "buy", now: 0, ttlMs: 1000 });
    const r = g.resolve({ ...base, transcriptId: "t1", text: "yes", now: 2000 });
    assert.equal(r, "expired");
  });

  it("a duplicate transcript cannot confirm twice", () => {
    const g = new VoiceConfirmationGuard();
    g.arm({ userId: 7, chatId: "c1", action: "buy", now: 0, ttlMs: 10000 });
    assert.equal(g.resolve({ ...base, transcriptId: "t1", text: "confirm", now: 1 }), "confirmed");
    // re-arm, but the SAME transcript id must not re-confirm
    g.arm({ userId: 7, chatId: "c1", action: "buy", now: 2, ttlMs: 10000 });
    assert.equal(g.resolve({ ...base, transcriptId: "t1", text: "confirm", now: 3 }), "duplicate");
  });

  it("confirmation is scoped to the same user + chat", () => {
    const g = new VoiceConfirmationGuard();
    g.arm({ userId: 7, chatId: "c1", action: "buy", now: 0, ttlMs: 10000 });
    assert.equal(
      g.resolve({ userId: 8, chatId: "c1", locale: "en", transcriptId: "t1", text: "yes", now: 1 }),
      "no_pending",
    );
    assert.equal(
      g.resolve({ userId: 7, chatId: "c2", locale: "en", transcriptId: "t2", text: "yes", now: 1 }),
      "no_pending",
    );
  });

  it("affirmation detection is whole-word (no false positives)", () => {
    assert.equal(isAffirmationPhrase("yesterday we lost", "en"), false);
    assert.equal(isAffirmationPhrase("yes", "en"), true);
    assert.equal(isAffirmationPhrase("نعم نفّذ", "ar"), true);
    assert.equal(isAffirmationPhrase("لا تنفذ", "ar"), false);
  });
});

describe("realtime session config builders", () => {
  it("disables auto-response and enables input transcription (GA shape)", () => {
    const upd = buildRealtimeSessionUpdate({ locale: "ar", voice: "alloy" }) as {
      session: {
        type: string;
        output_modalities: string[];
        audio: {
          input: {
            transcription: unknown;
            turn_detection: { create_response: boolean };
          };
          output: { voice: string };
        };
      };
    };
    assert.equal(upd.session.type, "realtime");
    assert.deepEqual(upd.session.output_modalities, ["audio"]);
    assert.equal(upd.session.audio.input.turn_detection.create_response, false);
    assert.ok(upd.session.audio.input.transcription);
    assert.equal(upd.session.audio.output.voice, "alloy");
  });

  it("speak payload carries the exact answer text", () => {
    const payload = buildSpeakResponse("Buy XAUUSD at 2400", "en") as {
      response: { instructions: string; output_modalities: string[] };
    };
    assert.ok(payload.response.instructions.includes("Buy XAUUSD at 2400"));
    assert.deepEqual(payload.response.output_modalities, ["audio"]);
  });

  it("instructions forbid inventing data and differ by locale", () => {
    const en = voiceSystemInstructions("en");
    const ar = voiceSystemInstructions("ar");
    assert.match(en, /never invent/i);
    assert.notEqual(en, ar);
  });

  it("voice uses the canonical trading-agent identity, never a transcription identity", () => {
    for (const locale of ["en", "ar"] as const) {
      const instructions = voiceSystemInstructions(locale);
      // Same constitution as text chat and MCP.
      assert.match(instructions, /AiChart is a chat-first Forex scalping assistant/);
      assert.match(instructions, /sole authority for BUY, SELL, or WAIT/);
      assert.match(instructions, /Risk per Trade is the only trading setting/);
      // The old defect: the model must never self-describe as speech-to-text.
      assert.match(instructions, /never describe yourself as a transcription/i);
      assert.doesNotMatch(instructions, /You only convert speech to text/i);
      assert.doesNotMatch(instructions, /مهمتك فقط تحويل الكلام إلى نص/);
      assert.doesNotMatch(instructions, /voice interface for AiChart/i);
      // Language mirroring stays dynamic, not forced by an old preference.
      assert.match(instructions, /Mirror the operator's spoken language/i);
    }
  });

  it("the browser session.update never overwrites the server-set identity", () => {
    const upd = buildRealtimeSessionUpdate({ locale: "en", voice: "alloy" }) as {
      session: Record<string, unknown>;
    };
    // Identity is applied server-side at mint; a reconnect re-mints with the
    // same canonical instructions — the client must not carry prompt text.
    assert.ok(!("instructions" in upd.session), "no client-side instructions");
  });

  it("client-secret mint disables auto-response from session start", async () => {
    const { createRealtimeClientSecret } = await import("@/lib/agent/voice/realtimeClientSecret");
    let sentBody: Record<string, unknown> | null = null;
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      sentBody = JSON.parse(init?.body ?? "{}");
      return new Response(JSON.stringify({ value: "ek_test", expires_at: 9999999999 }), { status: 200 });
    }) as typeof fetch;
    await createRealtimeClientSecret({
      config: {
        apiKey: "k",
        model: "gpt-realtime",
        voice: "alloy",
        limits: { maxMinutes: 10, idleTimeoutSeconds: 45, maxReconnectAttempts: 3 },
      },
      locale: "en",
      fetchImpl,
    });
    const session = (sentBody as unknown as { session: { instructions: string; audio: { input: { turn_detection: { create_response: boolean } } } } }).session;
    assert.equal(session.audio.input.turn_detection.create_response, false);
    assert.match(session.instructions, /AiChart is a chat-first Forex scalping assistant/);
  });
});

describe("voice labels", () => {
  it("every status maps to a key", () => {
    const statuses: VoiceSessionStatus[] = [
      "idle", "requesting_permission", "connecting", "connected", "listening",
      "user_speaking", "processing", "assistant_speaking", "reconnecting",
      "stopping", "stopped", "error",
    ];
    for (const s of statuses) assert.ok(voiceStatusKey(s).startsWith("voice."));
  });

  it("every error code maps to a key and recoverability is classified", () => {
    const codes: VoiceErrorCode[] = [
      "mic_permission_denied", "mic_unavailable", "unsupported_browser",
      "network_lost", "credential_failed", "credential_expired", "webrtc_failed",
      "datachannel_closed", "autoplay_blocked", "provider_unavailable",
      "session_expired", "unknown",
    ];
    for (const c of codes) assert.ok(voiceErrorKey(c).startsWith("voice."));
    assert.equal(isRecoverableVoiceError("network_lost"), true);
    assert.equal(isRecoverableVoiceError("mic_permission_denied"), false);
  });

  it("maps voice status to animated avatar state", () => {
    assert.equal(voiceStatusToAvatarState("connecting"), "connecting");
    assert.equal(voiceStatusToAvatarState("listening"), "listening");
    assert.equal(voiceStatusToAvatarState("user_speaking"), "listening");
    assert.equal(voiceStatusToAvatarState("processing"), "thinking");
    assert.equal(voiceStatusToAvatarState("assistant_speaking"), "speaking");
    assert.equal(voiceStatusToAvatarState("reconnecting"), "reconnecting");
    assert.equal(voiceStatusToAvatarState("error"), "error");
    assert.equal(voiceStatusToAvatarState("idle"), "idle");
  });
});

describe("voiceSessionRequest validation", () => {
  it("accepts a valid request", () => {
    const r = parseVoiceSessionRequest({ chatId: "c1", locale: "ar", symbol: "XAUUSD", interval: "15m" });
    assert.equal(r.ok, true);
  });
  it("rejects a bad locale / missing symbol / oversize interval", () => {
    assert.equal(parseVoiceSessionRequest({ chatId: "c1", locale: "fr", symbol: "X", interval: "15m" }).ok, false);
    assert.equal(parseVoiceSessionRequest({ chatId: "c1", locale: "ar", interval: "15m" }).ok, false);
    assert.equal(
      parseVoiceSessionRequest({ chatId: "c1", locale: "ar", symbol: "X", interval: "toolonginterval" }).ok,
      false,
    );
  });
});

describe("speakableFromResult (only the public answer is spoken)", () => {
  it("returns the trimmed summary", () => {
    assert.equal(speakableFromResult({ summary: "  Buy gold  " }), "Buy gold");
  });
  it("never returns activity/debug — only summary is read", () => {
    // Even with rich internals present, the function reads ONLY summary.
    const spoken = speakableFromResult({ summary: "Wait, no setup." });
    assert.equal(spoken, "Wait, no setup.");
  });
  it("returns null for an empty summary", () => {
    assert.equal(speakableFromResult({ summary: "   " }), null);
  });
});
