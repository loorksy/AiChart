/**
 * The account's language — ONE answer for every surface.
 *
 * Language is a property of the person, not of the channel they happened to
 * open. The web app, the Telegram bot, and the MCP tools all resolve it from
 * the same column, so changing it anywhere changes it everywhere; a user who
 * switches to English on the site does not then get Arabic from the bot.
 *
 * Unset means "never chosen", which resolves to the platform default
 * (English). It is deliberately NOT guessed from the message text or the
 * chat's Telegram client language: a guess that flips language mid-thread is
 * worse than a default the user can change once.
 */
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/lib/i18n";
import { getSettings } from "@/lib/store";

/** Normalize whatever is stored into a locale we actually have. */
export function localeFromStored(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The locale for a user id. Never throws: a surface that cannot read the
 * account still answers, in the platform default, rather than failing.
 */
export async function resolveUserLocale(
  userId: number | null | undefined,
): Promise<AppLocale> {
  if (!userId) return DEFAULT_LOCALE;
  try {
    const settings = await getSettings(userId);
    return localeFromStored(settings.language);
  } catch {
    return DEFAULT_LOCALE;
  }
}
