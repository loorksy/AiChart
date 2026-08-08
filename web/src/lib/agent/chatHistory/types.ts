/**
 * Persistent chat history types. A chat session groups the user/assistant
 * messages of one conversation with the Smart Chart Agent. Sessions survive
 * refresh (stored in the DB) and are listed in the sidebar.
 */
export type AgentChatLanguage = "ar" | "en";

/**
 * Which chat-capable agent owns a session/message. This is a hard isolation
 * boundary (see chatStore.ts) — a Quant Agent chat must never be readable or
 * appendable via a Lonora-scoped call and vice versa, even if the caller
 * knows the chatId.
 */
export type AgentChatAgentId = "lonora" | "quant_agent";

export interface AgentChatSession {
  id: string;
  userId: number;
  agentId: AgentChatAgentId;
  title: string;
  symbol?: string;
  interval?: string;
  language: AgentChatLanguage;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}

export interface AgentChatMessageRecord {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** The full AgentFinalResult for assistant messages (rendered on reload). */
  result?: unknown;
  recommendationId?: string;
  analysisId?: string;
  symbol?: string;
  interval?: string;
}

/** Payload accepted when appending a message (id/createdAt are server-filled). */
export interface AppendAgentChatMessageInput {
  agentId: AgentChatAgentId;
  role: "user" | "assistant";
  content: string;
  result?: unknown;
  recommendationId?: string;
  analysisId?: string;
  symbol?: string;
  interval?: string;
}
