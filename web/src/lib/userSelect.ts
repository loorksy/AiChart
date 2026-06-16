import type { PublicUser, UserRow } from "./types";

/** Shared user projection for PublicUser-shaped queries. */
export const PUBLIC_USER_COLUMNS =
  "id, email, role, status, username, whatsapp_e164, telegram_id, access_expires_at, created_at";

export function userRowToPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    username: row.username ?? null,
    whatsapp_e164: row.whatsapp_e164 ?? null,
    telegram_id: row.telegram_id ?? null,
    access_expires_at: row.access_expires_at ?? null,
    created_at: row.created_at,
  };
}
