/**
 * Persistent chat history types. A chat session groups the user/assistant
 * messages of one conversation with the Smart Chart Agent. Sessions survive
 * refresh (stored in the DB) and are listed in the sidebar.
 */
export type AgentChatLanguage = "ar" | "en";

export interface AgentChatSession {
  id: string;
  userId: number;
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
  role: "user" | "assistant";
  content: string;
  result?: unknown;
  recommendationId?: string;
  analysisId?: string;
  symbol?: string;
  interval?: string;
}
