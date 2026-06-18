import { createHmac } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { AppConfig } from "../config.js";

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function bridgeUserSig(serviceToken: string, email: string): string {
  return createHmac("sha256", serviceToken)
    .update(email.toLowerCase())
    .digest("hex");
}

/** Upstream request timeout (ms). Prevents a slow EA/exchange from hanging the
 *  whole MCP call until the platform's own timeout. Override via BRIDGE_FETCH_TIMEOUT_MS.
 *  Default 15s — a single forex EA round trip (queueEaGetOhlc) can take up to 12s. */
function bridgeFetchTimeoutMs(): number {
  const raw = Number(process.env.BRIDGE_FETCH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
}

/** fetch with an AbortController deadline; maps a timeout to a 504 BridgeError.
 *  `overrideMs` lets a slow endpoint (e.g. multi-timeframe forex) extend the budget. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  overrideMs?: number,
): Promise<Response> {
  const timeoutMs =
    overrideMs && overrideMs > 0 ? overrideMs : bridgeFetchTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new BridgeError(
        `انتهت مهلة الاتصال بالخادم (${timeoutMs}ms). حاول مجدداً.`,
        504,
        null,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class BridgeClient {
  constructor(
    private readonly cfg: AppConfig,
    private readonly actAsEmail?: string,
  ) {}

  static forUser(cfg: AppConfig, email: string): BridgeClient {
    return new BridgeClient(cfg, email.toLowerCase());
  }

  static fromAuthInfo(cfg: AppConfig, authInfo: AuthInfo): BridgeClient {
    const extra = authInfo.extra as { email?: string } | undefined;
    const email = extra?.email?.trim() || "";
    if (!email) {
      throw new BridgeError(
        "OAuth token missing user email — cannot scope bridge.",
        401,
        null,
      );
    }
    return BridgeClient.forUser(cfg, email);
  }

  private headers(): Record<string, string> {
    const base: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.serviceToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.actAsEmail) {
      const email = this.actAsEmail.toLowerCase();
      base["X-Aichart-User-Email"] = email;
      base["X-Aichart-User-Sig"] = bridgeUserSig(this.cfg.serviceToken, email);
    }
    return base;
  }

  async get(
    path: string,
    query?: Record<string, string | number | undefined>,
    timeoutMs?: number,
  ) {
    const url = new URL(`${this.cfg.apiUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return this.request(url.toString(), { method: "GET" }, timeoutMs);
  }

  /** GET that preserves status codes and supports binary PNG responses. */
  async getRaw(path: string): Promise<{
    status: number;
    contentType: string;
    body: Buffer | unknown;
  }> {
    if (!this.cfg.serviceToken) {
      throw new BridgeError(
        "AICHART_SERVICE_TOKEN غير مُعدّ على MCP Server.",
        503,
        null,
      );
    }
    if (this.cfg.authMode === "oauth" && !this.actAsEmail) {
      throw new BridgeError(
        "Bridge session missing user identity.",
        401,
        null,
      );
    }
    const url = `${this.cfg.apiUrl}${path}`;
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: this.headers(),
      cache: "no-store",
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("image/")) {
      const arrayBuf = await res.arrayBuffer();
      return {
        status: res.status,
        contentType,
        body: Buffer.from(arrayBuf),
      };
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, contentType, body: data };
  }

  async post(path: string, body?: unknown) {
    return this.request(`${this.cfg.apiUrl}${path}`, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async delete(path: string, body?: unknown) {
    return this.request(`${this.cfg.apiUrl}${path}`, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async patch(path: string, body?: unknown) {
    return this.request(`${this.cfg.apiUrl}${path}`, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (!this.cfg.serviceToken) {
      throw new BridgeError(
        "AICHART_SERVICE_TOKEN غير مُعدّ على MCP Server.",
        503,
        null,
      );
    }
    if (this.cfg.authMode === "oauth" && !this.actAsEmail) {
      throw new BridgeError(
        "Bridge session missing user identity.",
        401,
        null,
      );
    }
    const res = await fetchWithTimeout(
      url,
      {
        ...init,
        headers: { ...this.headers(), ...(init.headers as object) },
        cache: "no-store",
      },
      timeoutMs,
    );
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const msg =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Bridge ${res.status}`;
      throw new BridgeError(msg, res.status, data);
    }
    return data;
  }
}

function isBridgeFailureEnvelope(
  data: unknown,
): data is { ok: false; error: unknown } {
  return (
    typeof data === "object" &&
    data !== null &&
    "ok" in data &&
    (data as { ok: unknown }).ok === false &&
    "error" in data
  );
}

export function formatBridgeResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const isError = isBridgeFailureEnvelope(data);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    ...(isError ? { isError: true as const } : {}),
  };
}

export function formatBridgeError(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (err instanceof BridgeError) {
    if (isBridgeFailureEnvelope(err.body)) {
      return { ...formatBridgeResult(err.body), isError: true as const };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: err.message, status: err.status, body: err.body },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}
