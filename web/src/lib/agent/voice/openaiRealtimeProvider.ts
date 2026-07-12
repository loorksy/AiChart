/**
 * OpenAI Realtime provider over WebRTC. This is the ONLY file that knows the
 * provider's raw event names and transport — it normalizes everything into
 * `VoiceProviderEvent` so the hook/UI stay provider-agnostic and replaceable.
 *
 * Browser-only (RTCPeerConnection / getUserMedia / MediaStream). The standard
 * API key is never here — only the short-lived client secret minted server-side.
 * Every resource opened by start() is released by stop().
 */
import type { AppLocale } from "@/lib/i18n";
import type {
  VoiceProviderEvent,
  VoiceProviderSession,
  VoiceSessionCredential,
} from "./types";
import {
  buildRealtimeSessionUpdate,
  buildSpeakResponse,
} from "./voiceSessionInstructions";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export interface OpenAIRealtimeProviderOptions {
  credential: VoiceSessionCredential;
  locale: AppLocale;
  onEvent: (event: VoiceProviderEvent) => void;
}

export function createOpenAIRealtimeProvider(
  opts: OpenAIRealtimeProviderOptions,
): VoiceProviderSession {
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let micStream: MediaStream | null = null;
  let audioEl: HTMLAudioElement | null = null;
  const seenAssistantAudio = { active: false };

  const emit = (event: VoiceProviderEvent) => {
    try {
      opts.onEvent(event);
    } catch {
      /* listener threw — never let it break the session */
    }
  };

  const send = (payload: Record<string, unknown>) => {
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(payload));
      } catch {
        /* channel closing */
      }
    }
  };

  function handleServerEvent(raw: string) {
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "input_audio_buffer.speech_started":
        emit({ kind: "user_speech_started" });
        break;
      case "input_audio_buffer.speech_stopped":
        emit({ kind: "user_speech_stopped" });
        break;
      case "conversation.item.input_audio_transcription.delta": {
        const text = String(msg.delta ?? "");
        if (text) {
          emit({
            kind: "transcript",
            transcript: {
              id: String(msg.item_id ?? "partial"),
              role: "user",
              text,
              final: false,
              createdAt: Date.now(),
            },
          });
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(msg.transcript ?? "");
        emit({
          kind: "transcript",
          transcript: {
            id: String(msg.item_id ?? `final-${Date.now()}`),
            role: "user",
            text,
            final: true,
            createdAt: Date.now(),
          },
        });
        break;
      }
      case "output_audio_buffer.started":
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (!seenAssistantAudio.active) {
          seenAssistantAudio.active = true;
          emit({ kind: "assistant_audio_started" });
        }
        break;
      case "output_audio_buffer.stopped":
      case "response.done":
      case "response.audio.done":
      case "response.output_audio.done":
        if (seenAssistantAudio.active) {
          seenAssistantAudio.active = false;
          emit({ kind: "assistant_audio_stopped" });
        }
        break;
      case "error":
        emit({ kind: "error", code: "provider_unavailable", message: "provider_error" });
        break;
      default:
        break;
    }
  }

  async function start(): Promise<void> {
    if (typeof RTCPeerConnection === "undefined" || !navigator?.mediaDevices) {
      emit({ kind: "error", code: "unsupported_browser" });
      throw new Error("unsupported_browser");
    }

    emit({ kind: "status", status: "connecting" });

    // 1. Microphone (explicit user action already occurred in the UI).
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError");
      emit({ kind: "error", code: denied ? "mic_permission_denied" : "mic_unavailable" });
      throw err;
    }

    pc = new RTCPeerConnection();

    // 2. Remote assistant audio sink.
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      if (audioEl) audioEl.srcObject = e.streams[0] ?? null;
    };

    // 3. Microphone track.
    for (const track of micStream.getAudioTracks()) {
      pc.addTrack(track, micStream);
    }

    // 4. Event data channel.
    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("message", (e) => handleServerEvent(String(e.data)));
    dc.addEventListener("open", () => {
      send(buildRealtimeSessionUpdate({ locale: opts.locale, voice: opts.credential.voice }));
      emit({ kind: "status", status: "connected" });
      emit({ kind: "status", status: "listening" });
    });
    dc.addEventListener("close", () => {
      emit({ kind: "error", code: "datachannel_closed" });
    });

    pc.addEventListener("connectionstatechange", () => {
      const s = pc?.connectionState;
      if (s === "failed") emit({ kind: "error", code: "webrtc_failed" });
      else if (s === "disconnected") emit({ kind: "error", code: "network_lost" });
    });

    // 5. SDP offer/answer with the ephemeral client secret (never the API key).
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    let sdpRes: Response;
    try {
      sdpRes = await fetch(`${REALTIME_CALLS_URL}?model=${encodeURIComponent(opts.credential.model)}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${opts.credential.clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });
    } catch {
      emit({ kind: "error", code: "network_lost" });
      throw new Error("sdp_exchange_failed");
    }
    if (!sdpRes.ok) {
      emit({
        kind: "error",
        code: sdpRes.status === 401 ? "credential_expired" : "webrtc_failed",
      });
      throw new Error("sdp_exchange_failed");
    }
    const answerSdp = await sdpRes.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  async function stop(): Promise<void> {
    seenAssistantAudio.active = false;
    try {
      dc?.close();
    } catch {
      /* ignore */
    }
    dc = null;
    if (micStream) {
      for (const track of micStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      micStream = null;
    }
    try {
      pc?.getSenders().forEach((s) => s.track?.stop());
      pc?.close();
    } catch {
      /* ignore */
    }
    pc = null;
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
      } catch {
        /* ignore */
      }
      audioEl = null;
    }
  }

  return {
    start,
    stop,
    mute() {
      micStream?.getAudioTracks().forEach((t) => (t.enabled = false));
    },
    unmute() {
      micStream?.getAudioTracks().forEach((t) => (t.enabled = true));
    },
    interrupt() {
      // Barge-in: cancel the model's in-flight response and duck local audio.
      send({ type: "response.cancel" });
      send({ type: "output_audio_buffer.clear" });
      if (audioEl) {
        try {
          audioEl.pause();
          audioEl.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
      seenAssistantAudio.active = false;
    },
    sendText(text: string) {
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      });
    },
    async speakText(text: string) {
      // Speak Lonora's authoritative final answer verbatim.
      send(buildSpeakResponse(text, opts.locale));
    },
  };
}
