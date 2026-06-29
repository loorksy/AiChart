import { create } from "zustand";
import { imageDataUrl, parseImageFromMetadata } from "@/lib/chatImage";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { Conversation, ChatMessageRow, Recommendation } from "@/lib/types";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import type { LiveReasoningEntry } from "@/lib/analysis/chartAnalyzeLlm";
import type { TradingCardPayload } from "@/lib/cards/cardTypes";

export interface ChartAnalyzeMeta {
  symbol?: string;
  interval?: string;
  market?: string;
  type?: string;
  analysis_source?: string;
  drawings?: ChartDrawing[];
  overlays?: ChartOverlay[];
  recommendation_id?: number | null;
  recommendation?: Partial<Recommendation> | null;
  liveReasoningLog?: LiveReasoningEntry[];
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string | null;
  streaming?: boolean;
  recommendations?: unknown[];
  intents?: ProcessedIntent[];
  question?: {
    type: string;
    text: string;
    options: { label: string; value: string }[];
  } | null;
  ui_schema?: any;
  trading_cards?: TradingCardPayload[];
  chartAnalyze?: ChartAnalyzeMeta;
}

interface ChatState {
  conversations: Conversation[];
  archived: Conversation[];
  /** Numeric id — used internally (e.g. POST /api/chat). Not exposed in URLs. */
  selectedId: number | null;
  /** Opaque slug — what appears in the URL (?c=<slug>). */
  selectedSlug: string | null;
  messages: UiMessage[];
  loading: boolean;
  fetchConversations: () => Promise<void>;
  /** Select by opaque slug (from the sidebar or the URL). */
  selectConversation: (slug: string) => Promise<void>;
  createNew: () => Promise<number>;
  deleteConversation: (slug: string) => Promise<void>;
  archiveConversation: (slug: string) => Promise<void>;
  setMessages: (messages: UiMessage[]) => void;
  appendMessage: (msg: UiMessage) => void;
  updateLastAssistant: (patch: Partial<UiMessage>) => void;
  resetSelection: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  archived: [],
  selectedId: null,
  selectedSlug: null,
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

  selectConversation: async (slug) => {
    set({ loading: true, selectedSlug: slug });
    const res = await fetch(`/api/conversations/${encodeURIComponent(slug)}`);
    if (!res.ok) {
      set({ loading: false });
      return;
    }
    const data = (await res.json()) as {
      conversation?: Conversation;
      messages: ChatMessageRow[];
    };
    if (data.conversation) {
      set({
        selectedId: data.conversation.id,
        selectedSlug: data.conversation.public_id,
      });
    }
    set({
      messages: (data.messages ?? []).map((m) => {
        const image = parseImageFromMetadata(m.metadata_json);
        let recommendations: unknown[] | undefined;
        let intents: any[] | undefined;
        let question: any = null;
        let ui_schema: any = null;
        let trading_cards: TradingCardPayload[] | undefined;
        let chartAnalyze: ChartAnalyzeMeta | undefined;
        if (m.metadata_json) {
          try {
            const parsedMeta = JSON.parse(m.metadata_json) as {
              recommendations?: unknown[];
              intents?: any[];
              question?: any;
              ui_schema?: any;
              type?: string;
              analysis_source?: string;
              symbol?: string;
              interval?: string;
              market?: string;
              drawings?: ChartDrawing[];
              overlays?: ChartOverlay[];
              recommendation_id?: number | null;
              recommendation?: Partial<Recommendation> | null;
              liveReasoningLog?: LiveReasoningEntry[];
              trading_cards?: TradingCardPayload[];
            };
            recommendations = parsedMeta.recommendations;
            intents = parsedMeta.intents?.filter((i) => i?.status === "pending");
            question = parsedMeta.question || null;
            ui_schema = parsedMeta.ui_schema || null;
            trading_cards = parsedMeta.trading_cards;
            if (
              parsedMeta.type === "chart_analyze" ||
              parsedMeta.analysis_source != null ||
              parsedMeta.drawings
            ) {
              chartAnalyze = {
                symbol: parsedMeta.symbol,
                interval: parsedMeta.interval,
                market: parsedMeta.market,
                type: parsedMeta.type,
                analysis_source: parsedMeta.analysis_source,
                drawings: parsedMeta.drawings,
                overlays: parsedMeta.overlays,
                recommendation_id: parsedMeta.recommendation_id,
                recommendation: parsedMeta.recommendation ?? null,
                liveReasoningLog: parsedMeta.liveReasoningLog,
              };
            }
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
          intents: intents && intents.length ? intents : undefined,
          question,
          ui_schema,
          trading_cards,
          chartAnalyze,
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
    set({ selectedId: conv.id, selectedSlug: conv.public_id, messages: [] });
    await get().fetchConversations();
    return conv.id;
  },

  deleteConversation: async (slug) => {
    await fetch(`/api/conversations/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    if (get().selectedSlug === slug) {
      set({ selectedId: null, selectedSlug: null, messages: [] });
    }
    await get().fetchConversations();
  },

  archiveConversation: async (slug) => {
    await fetch(`/api/conversations/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (get().selectedSlug === slug) {
      set({ selectedId: null, selectedSlug: null, messages: [] });
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
  resetSelection: () =>
    set({ selectedId: null, selectedSlug: null, messages: [] }),
}));
