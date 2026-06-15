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

export class BridgeClient {
  constructor(private readonly cfg: AppConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.serviceToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async get(path: string, query?: Record<string, string | number | undefined>) {
    const url = new URL(`${this.cfg.apiUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return this.request(url.toString(), { method: "GET" });
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

  private async request(url: string, init: RequestInit): Promise<unknown> {
    if (!this.cfg.serviceToken) {
      throw new BridgeError(
        "AICHART_SERVICE_TOKEN غير مُعدّ على MCP Server.",
        503,
        null,
      );
    }
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers(), ...(init.headers as object) },
      cache: "no-store",
    });
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

export function formatBridgeResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function formatBridgeError(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (err instanceof BridgeError) {
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
