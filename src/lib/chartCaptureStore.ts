import crypto from "crypto";

const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, { buffer: Buffer; expires: number }>();

export function putChartCapture(buffer: Buffer): string {
  const key = crypto.randomBytes(12).toString("hex");
  store.set(key, { buffer, expires: Date.now() + TTL_MS });
  return key;
}

export function getChartCapture(key: string): Buffer | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.buffer;
}
