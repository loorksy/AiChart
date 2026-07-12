/**
 * Dynamic, model-generated follow-up suggestions shown after an assistant turn.
 * Structurally compatible with AgentOption so the existing number-reply
 * resolver keeps working. There is deliberately NO static fallback list — if
 * generation fails the UI shows no suggestions at all.
 */
export type AgentSuggestion = {
  id: string;
  label: string;
  prompt: string;
};
