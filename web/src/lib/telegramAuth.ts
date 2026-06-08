import crypto from "crypto";

export interface TelegramLoginPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const MAX_AUTH_AGE_SEC = 86_400;

/** Verifies data from Telegram Login Widget (https://core.telegram.org/widgets/login) */
export function verifyTelegramLogin(
  data: TelegramLoginPayload,
  botToken: string,
): boolean {
  const { hash, ...rest } = data;
  if (!hash || !rest.id || !rest.auth_date) return false;

  const age = Math.floor(Date.now() / 1000) - Number(rest.auth_date);
  if (age < 0 || age > MAX_AUTH_AGE_SEC) return false;

  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${(rest as Record<string, unknown>)[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  return computed === hash;
}

export function telegramDisplayEmail(payload: TelegramLoginPayload): string {
  if (payload.username) {
    return `${payload.username.toLowerCase()}@telegram.user`;
  }
  return `tg_${payload.id}@telegram.user`;
}
