/**
 * Typed MT5 server name from the user's terminal. No broker catalogue —
 * Lonora never asks them to pick from a fixed list.
 */
export const BROKER_PLATFORM = "mt5" as const;

const SERVER_RE = /^[A-Za-z0-9][A-Za-z0-9._\- ]{0,78}$/;
const LOGIN_RE = /^[A-Za-z0-9._-]{1,32}$/;

export function normalizeServer(server: string): string | null {
  const trimmed = server.trim().replace(/\s+/g, " ");
  if (!SERVER_RE.test(trimmed)) return null;
  return trimmed;
}

export function normalizeLogin(login: string): string | null {
  const trimmed = login.trim();
  if (!LOGIN_RE.test(trimmed)) return null;
  return trimmed;
}

export function brokerIdForServer(server: string): string {
  return `server:${server.toLowerCase()}`;
}
