/**
 * Standing authorisation for a bot-bound intent, re-checked at execute time.
 *
 * Mirror of `isAutoExecutionAuthorized` for recommendations: the grant that
 * stamped the intent may have been revoked between create and send, so the
 * choke point asks again rather than trusting a stale row.
 *
 * A bot grant holds when:
 *   - the deploy flag is still on, and
 *   - the bot still exists, still belongs to the user, and is still `live`.
 *
 * Kill switch / dual enablement / stage are NOT checked here — `executeIntent`
 * already owns those.
 */
import { botExecutionFlagEnabled } from "./brokerPort";
import { getBot } from "../botStore";

export async function isBotStandingAuthorized(
  userId: number,
  botId: string,
): Promise<boolean> {
  if (!botExecutionFlagEnabled()) return false;
  const id = botId.trim();
  if (!id) return false;
  const bot = await getBot(userId, id).catch(() => null);
  if (!bot) return false;
  if (bot.ownerUserId !== userId) return false;
  return bot.executionMode === "live";
}
