import { bridgeUserSig } from "./agentAuth";
import { fetchWithTimeout, httpTimeoutMs } from "./externalFetch";
import { getPublicUser } from "./store";

/**
 * Internal bridge client — lets the in-process web chat agent call the SAME
 * `/api/agent/*` routes the MCP server uses, with zero logic duplication. It
 * authenticates exactly like the MCP bridge (service token + user email + HMAC
 * sig), so technical execution safety and idempotency run identically.
 */
function selfBaseUrl(): string {
  const override = process.env.AICHART_SELF_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}`;
}

function serviceToken(): string {
  const raw = process.env.AICHART_SERVICE_TOKEN?.trim().replace(/\r$/, "");
  if (!raw || raw.length < 16) {
    throw new Error("AICHART_SERVICE_TOKEN غير مُعدّ — لا يمكن للوكيل التنفيذ.");
  }
  return raw;
}

export interface InternalBridge {
  get(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  patch(path: string, body?: unknown): Promise<unknown>;
}

/** Builds a bridge scoped to one user (by id). Throws if the user has no email. */
export async function internalBridgeForUser(
  userId: number,
): Promise<InternalBridge> {
  const user = await getPublicUser(userId);
  const email = user?.email?.trim().toLowerCase();
  if (!email) throw new Error("تعذّر تحديد هوية المستخدم لتنفيذ الأداة.");
  const sig = bridgeUserSig(email);
  if (!sig) throw new Error("جسر الوكيل غير مفعّل (التوكن مفقود).");

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${serviceToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Aichart-User-Email": email,
    "X-Aichart-User-Sig": sig,
  });

  const base = selfBaseUrl();

  const parse = async (res: Response): Promise<unknown> => {
    const text = await res.text();
    if (!text) return { ok: res.ok, status: res.status };
    try {
      return JSON.parse(text);
    } catch {
      return { ok: res.ok, status: res.status, body: text };
    }
  };

  return {
    async get(path, query) {
      const url = new URL(`${base}${path}`);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null && v !== "") {
            url.searchParams.set(k, String(v));
          }
        }
      }
      const res = await fetchWithTimeout(
        url.toString(),
        { method: "GET", headers: headers(), cache: "no-store" },
        { timeoutMs: httpTimeoutMs(), label: "internal bridge" },
      );
      return parse(res);
    },
    async post(path, body) {
      const res = await fetchWithTimeout(
        `${base}${path}`,
        {
          method: "POST",
          headers: headers(),
          cache: "no-store",
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        { timeoutMs: httpTimeoutMs(), label: "internal bridge" },
      );
      return parse(res);
    },
    async patch(path, body) {
      const res = await fetchWithTimeout(
        `${base}${path}`,
        {
          method: "PATCH",
          headers: headers(),
          cache: "no-store",
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        { timeoutMs: httpTimeoutMs(), label: "internal bridge" },
      );
      return parse(res);
    },
  };
}
