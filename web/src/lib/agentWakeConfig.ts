/**
 * Telegram agent wakes. Default off — MCP conversational mode.
 * Set AGENT_WAKE_ENABLED=1 to re-enable cron wakes.
 */
export function isAgentWakeEnabled(): boolean {
  const raw = process.env.AGENT_WAKE_ENABLED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return false;
}
