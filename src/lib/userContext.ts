import { getPublicUser, getSettings, listRecommendations } from "./store";
import { DISPLAY_NAME_EN } from "./gold";
import { displayNameFromEmail } from "./displayName";

export { displayNameFromEmail };

/**
 * Current, factual context only.
 *
 * Trades, open positions, pending approvals and broker-connection state are
 * gone with the execution layer: this platform issues recommendations and has
 * no account to report on. What remains is who the user is, how they have
 * configured their analysis, and what they were recently recommended.
 */
export async function buildUserContext(userId: number): Promise<string> {
  const user = await getPublicUser(userId);
  if (!user) return "";

  const settings = await getSettings(userId);
  const recommendations = await listRecommendations(userId, 3);
  const name = displayNameFromEmail(user.email);

  const lines = [
    "# Current user context (factual platform data)",
    `- User: ${name} (${user.email}); account status: ${user.status}`,
    `- Instrument: ${DISPLAY_NAME_EN} (XAUUSD) — the platform's only instrument`,
    `- Analysis style: scalping only; higher timeframes are evidence`,
    `- Risk per Trade: ${settings.per_trade_pct}% — used only for the educational position-size example, no account is sized`,
    `- Telegram: ${settings.telegram_chat_id ? "linked" : "not linked"}`,
  ];

  if (recommendations.length) {
    lines.push(
      `- Recent recommendations: ${recommendations.map((r) => `${r.symbol} ${r.action}`).join(" · ")}`,
    );
  }

  return lines.join("\n");
}
