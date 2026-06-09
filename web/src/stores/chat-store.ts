import { create } from "zustand";
import { imageDataUrl, parseImageFromMetadata } from "@/lib/chatImage";
import type { Conversation, ChatMessageRow } from "@/lib/types";
import type { ProcessedIntent } from "@/lib/tradeFlow";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string | null;
  streaming?: boolean;
  recommendations?: unknown[];
  intents?: ProcessedIntent[];
}

interface ChatState {
  conversations: Conversation[];
  archived: Conversation[];
  selectedId: number | null;
  messages: UiMessage[];
  loading: boolean;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: number) => Promise<void>;
  createNew: () => Promise<number>;
  deleteConversation: (id: number) => Promise<void>;
  archiveConversation: (id: number) => Promise<void>;
  setMessages: (messages: UiMessage[]) => void;
  appendMessage: (msg: UiMessage) => void;
  updateLastAssistant: (patch: Partial<UiMessage>) => void;
  resetSelection: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  archived: [],
  selectedId: null,
  messages: [],
  loading: false,

  fetchConversations: async () => {
    const [active, arch] = await Promise.all([
      fetch("/api/conversations").then((r) => r.json()),
      fetch("/api/conversations?archived=1").then((r) => r.json()),
    ]);
    set({
      conversations: Array.isArray(active)
        ? active
        : (active.conversations ?? []),
      archived: Array.isArray(arch) ? arch : (arch.conversations ?? []),
    });
  },

  selectConversation: async (id) => {
    set({ loading: true, selectedId: id });
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) {
      set({ loading: false });
      return;
    }
    const data = (await res.json()) as {
      messages: ChatMessageRow[];
    };
    set({
      messages: (data.messages ?? []).map((m) => {
        const image = parseImageFromMetadata(m.metadata_json);
        let recommendations: unknown[] | undefined;
        if (m.metadata_json) {
          try {
            recommendations = (
              JSON.parse(m.metadata_json) as { recommendations?: unknown[] }
            ).recommendations;
          } catch {
            recommendations = undefined;
          }
        }
        return {
          id: String(m.id),
          role: m.role,
          content: m.content,
          imageUrl: image ? imageDataUrl(image) : undefined,
          recommendations,
        };
      }),
      loading: false,
    });
  },

  createNew: async () => {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = (await res.json()) as Conversation | { conversation: Conversation };
    const conv: Conversation =
      "conversation" in data ? data.conversation : data;
    const id = conv.id;
    set({ selectedId: id, messages: [] });
    await get().fetchConversations();
    return id;
  },

  deleteConversation: async (id) => {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (get().selectedId === id) {
      set({ selectedId: null, messages: [] });
    }
    await get().fetchConversations();
  },

  archiveConversation: async (id) => {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (get().selectedId === id) {
      set({ selectedId: null, messages: [] });
    }
    await get().fetchConversations();
  },

  setMessages: (messages) => set({ messages }),
  appendMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistant: (patch) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], ...patch };
          break;
        }
      }
      return { messages: msgs };
    }),
  resetSelection: () => set({ selectedId: null, messages: [] }),
}));
