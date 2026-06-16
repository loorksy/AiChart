import type { PublicUser } from "./types";

export function isSyntheticTelegramEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@telegram.user");
}

export function needsMcpCredentials(user: Pick<PublicUser, "email">): boolean {
  return isSyntheticTelegramEmail(user.email);
}
