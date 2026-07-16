import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createOpenAIRealtimeProvider } from "@/lib/agent/voice/openaiRealtimeProvider";
import type {
  VoiceProviderEvent,
  VoiceSessionCredential,
} from "@/lib/agent/voice/types";

const credential: VoiceSessionCredential = {
  clientSecret: "ek_test",
  expiresAt: Date.now() + 60_000,
  model: "gpt-realtime",
  voice: "alloy",
  sessionId: "s1",
  limits: { maxMinutes: 10, idleTimeoutSeconds: 45, maxReconnectAttempts: 3 },
};

interface Spies {
  trackStopped: number;
  pcClosed: number;
  dcClosed: number;
  audioPaused: number;
  sentAuth?: string;
}

function installBrowserMocks(spies: Spies, { autoOpen = true }: { autoOpen?: boolean } = {}) {
  const track = {
    kind: "audio",
    enabled: true,
    stop() {
      spies.trackStopped += 1;
    },
  };
  const micStream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  const dc = {
    readyState: "connecting" as RTCDataChannelState,
    listeners: {} as Record<string, (e: unknown) => void>,
    addEventListener(type: string, cb: (e: unknown) => void) {
      this.listeners[type] = cb;
    },
    send() {},
    close() {
      spies.dcClosed += 1;
    },
  };
  class FakeRTCPeerConnection {
    ontrack: ((e: unknown) => void) | null = null;
    createDataChannel() {
      return dc;
    }
    addTrack() {}
    addEventListener() {}
    async createOffer() {
      return { sdp: "v=0-offer", type: "offer" };
    }
    async setLocalDescription() {}
    async setRemoteDescription() {
      if (autoOpen) {
        dc.readyState = "open";
        dc.listeners.open?.({});
      }
    }
    getSenders() {
      return [{ track }];
    }
    close() {
      spies.pcClosed += 1;
    }
  }
  const audioEl = {
    autoplay: false,
    srcObject: null as unknown,
    currentTime: 0,
    pause() {
      spies.audioPaused += 1;
    },
  };

  const originals = {
    RTCPeerConnection: (globalThis as Record<string, unknown>).RTCPeerConnection,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    document: (globalThis as Record<string, unknown>).document,
    fetch: globalThis.fetch,
  };

  (globalThis as Record<string, unknown>).RTCPeerConnection = FakeRTCPeerConnection;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => micStream } },
  });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => audioEl,
  };
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    spies.sentAuth = (init?.headers as Record<string, string>)?.Authorization;
    return { ok: true, status: 200, text: async () => "v=0-answer" } as unknown as Response;
  }) as unknown as typeof fetch;

  return { dc, restore() {
    (globalThis as Record<string, unknown>).RTCPeerConnection = originals.RTCPeerConnection;
    if (originals.navigator) Object.defineProperty(globalThis, "navigator", originals.navigator);
    (globalThis as Record<string, unknown>).document = originals.document;
    globalThis.fetch = originals.fetch;
  } };
}

let restoreFn: (() => void) | null = null;
afterEach(() => {
  restoreFn?.();
  restoreFn = null;
});

describe("openaiRealtimeProvider lifecycle + cleanup", () => {
  it("starts a WebRTC session with the ephemeral secret (never the API key)", async () => {
    const spies: Spies = { trackStopped: 0, pcClosed: 0, dcClosed: 0, audioPaused: 0 };
    const { restore } = installBrowserMocks(spies);
    restoreFn = restore;
    const events: VoiceProviderEvent[] = [];

    const provider = createOpenAIRealtimeProvider({
      credential,
      locale: "en",
      onEvent: (e) => events.push(e),
    });
    await provider.start();

    // The SDP handshake authenticates with the short-lived client secret only.
    assert.equal(spies.sentAuth, "Bearer ek_test");
    assert.ok(events.some((e) => e.kind === "status" && e.status === "connecting"));

    await provider.stop();
    assert.equal(spies.trackStopped >= 1, true, "mic track stopped");
    assert.equal(spies.pcClosed, 1, "peer connection closed");
    assert.equal(spies.dcClosed, 1, "data channel closed");
    assert.equal(spies.audioPaused, 1, "remote audio paused");
  });

  it("emits unsupported_browser when WebRTC is unavailable", async () => {
    const original = (globalThis as Record<string, unknown>).RTCPeerConnection;
    (globalThis as Record<string, unknown>).RTCPeerConnection = undefined;
    restoreFn = () => {
      (globalThis as Record<string, unknown>).RTCPeerConnection = original;
    };
    const events: VoiceProviderEvent[] = [];
    const provider = createOpenAIRealtimeProvider({
      credential,
      locale: "en",
      onEvent: (e) => events.push(e),
    });
    await assert.rejects(() => provider.start());
    assert.ok(events.some((e) => e.kind === "error" && e.code === "unsupported_browser"));
  });

  it("fails within a finite timeout when the data channel never opens", async () => {
    const spies: Spies = { trackStopped: 0, pcClosed: 0, dcClosed: 0, audioPaused: 0 };
    const { restore } = installBrowserMocks(spies, { autoOpen: false });
    restoreFn = restore;
    const events: VoiceProviderEvent[] = [];
    const provider = createOpenAIRealtimeProvider({
      credential,
      locale: "en",
      onEvent: (e) => events.push(e),
      connectTimeoutMs: 10,
    });

    await assert.rejects(
      () => provider.start(),
      (error: unknown) => (error as { code?: string }).code === "webrtc_failed",
    );
    assert.ok(events.some((event) => event.kind === "status" && event.status === "connecting"));
    await provider.stop();
  });
});
