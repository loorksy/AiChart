/** Client-safe Odysseus embed param sanitizers (no server/db imports). */

export function sanitizeOdysseusSymbol(raw: string | null | undefined): string {
  const s = (raw ?? "EURUSD").toUpperCase().replace(/[^A-Z0-9._]/g, "");
  return s.length >= 6 ? s.slice(0, 12) : "EURUSD";
}

export function sanitizeOdysseusInterval(raw: string | null | undefined): string {
  const allowed = new Set([
    "1m",
    "3m",
    "5m",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "1d",
    "1w",
  ]);
  const iv = (raw ?? "15m").toLowerCase();
  return allowed.has(iv) ? iv : "15m";
}

export function sanitizeOdysseusSource(
  raw: string | null | undefined,
): "oanda" | "ea" {
  return raw === "ea" ? "ea" : "oanda";
}
