import type { PublicUser } from "./types";

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.replace(/[._-]/g, " ").trim() || email;
}

export function displayNameForUser(user: Pick<PublicUser, "username" | "email">): string {
  if (user.username?.trim()) return user.username.trim();
  return displayNameFromEmail(user.email);
}
