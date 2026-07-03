export function normalizeConfidence(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return 0;
  const scaled = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}
