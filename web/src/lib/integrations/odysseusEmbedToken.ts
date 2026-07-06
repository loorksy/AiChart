import crypto from "crypto";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function serviceSecret(): string | null {
  const raw = process.env.AICHART_SERVICE_TOKEN?.trim().replace(/\r$/, "");
  return raw && raw.length >= 16 ? raw : null;
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64url");
}

function fromB64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export interface OdysseusEmbedPayload {
  email: string;
  sessionId?: string;
  exp: number;
}

export function mintOdysseusEmbedToken(
  email: string,
  sessionId?: string,
): string | null {
  const secret = serviceSecret();
  if (!secret) return null;
  const payload: OdysseusEmbedPayload = {
    email: email.trim().toLowerCase(),
    sessionId: sessionId?.trim() || undefined,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOdysseusEmbedToken(token: string): OdysseusEmbedPayload | null {
  const secret = serviceSecret();
  if (!secret || !token.includes(".")) return null;
  const [body, sig] = token.split(".", 2);
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body)) as OdysseusEmbedPayload;
    if (!payload.email || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
