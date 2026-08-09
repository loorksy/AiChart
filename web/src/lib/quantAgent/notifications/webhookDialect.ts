/**
 * Outbound webhook DIALECTS — turning one internal monitor-fire payload into
 * the JSON body each chat vendor actually accepts, and reading each vendor's
 * idea of "that failed" back out of a 200 response.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/notifications/webhook.py`
 * (`detect_webhook_dialect`, `build_webhook_text`, `adapt_payload_for_dialect`,
 * `check_vendor_response`, `feishu_sign`, `dingtalk_signed_url`, `shorten`,
 * `format_float`) with the generic-signing contract taken from
 * `.../signal_notifier.py:804-818`.
 *
 * Upstream ships TWO copies of this logic: the one wired into
 * `signal_notifier._notify_webhook`, and this unused module. The unused one is
 * strictly better and is what is ported here — host+path detection instead of
 * bare host matching (so `https://oapi.dingtalk.com/` with an unrelated path is
 * not silently treated as a DingTalk robot), markdown bodies for DingTalk and
 * WeCom instead of flattening everything to plain text, a 4000-character cap so
 * a long rationale cannot make the vendor reject the whole message, and a
 * response check that understands Slack's literal `ok` body (the active copy
 * JSON-parses it, gets `{}`, and calls the send a success by accident).
 *
 * What changed from upstream:
 *  - No `discord` dialect. Upstream's active copy has a real bug here — a
 *    Discord URL in the `webhook` field falls through to `generic` and posts a
 *    body Discord rejects — and the fix upstream chose was a separate
 *    `_notify_discord` channel. AiChart has no Discord channel, so a Discord
 *    URL is treated as `generic`, posts a generic body, and is recorded as the
 *    vendor rejection it is. Nothing pretends to have delivered.
 *  - No `email` anything: this platform has no SMTP, so there is no email
 *    channel to build a body for.
 *  - Detection is ANCHORED, not a substring search. Upstream's
 *    `prefix in url.lower()` lets any host claim a vendor by putting the
 *    vendor's path inside its own — which, once signing exists, hands that host
 *    a signature derived from the operator's shared secret. See
 *    `DIALECT_PATTERNS` below.
 *  - The generic signature headers are `X-AiChart-Timestamp` /
 *    `X-AiChart-Signature` rather than upstream's `X-QD-*`. The SCHEME is
 *    unchanged and is the part receivers verify against:
 *    `HMAC-SHA256(secret, "{unix_seconds}." + <compact JSON body>)`, lowercase
 *    hex — and the caller must post the exact bytes that were signed.
 *  - Text is built from the fields a fired AiChart monitor actually has. A
 *    level the engine did not produce (no entry, no take-profit) is OMITTED
 *    from the body, never rendered as 0.
 *
 * Pure and dependency-free apart from `node:crypto`, so every branch is
 * unit-testable without a socket. The transport, and the SSRF hardening that
 * guards it, live in `webhookDelivery.ts`.
 */
import { createHmac } from "node:crypto";

export type WebhookDialect = "feishu" | "dingtalk" | "wecom" | "slack" | "generic";

/**
 * Upstream's `_WEBHOOK_DIALECT_PATTERNS`, split into an EXACT hostname and a
 * path PREFIX. Both halves are anchored, and that anchoring is a security
 * property, not tidiness.
 *
 * Upstream matches `prefix in url.lower()` — a substring search over the whole
 * URL. So does any port that keeps `String.includes`, even one narrowed to
 * `host + pathname`: `https://evil.example.com/oapi.dingtalk.com/robot/send`
 * contains the DingTalk needle in its PATH and is classified as DingTalk.
 * That matters here in a way it does not upstream, because the dialect decides
 * where the operator's shared signing secret goes — a DingTalk classification
 * appends `HMAC-SHA256(secret, "{ms}\n{secret}")` to the outbound URL, and a
 * Feishu one puts the equivalent digest in the body. A user who can type a
 * webhook URL into a form could therefore point an attacker-controlled host at
 * `QUANT_AGENT_WEBHOOK_SIGNING_SECRET` and collect an offline-crackable oracle
 * for it.
 *
 * Hostname is compared for equality (so `oapi.dingtalk.com.evil.example.com`
 * and `evil.example.com/oapi.dingtalk.com/...` are both `generic`); the path is
 * a true prefix (so `oapi.dingtalk.com/some/other/api` stays `generic`, which
 * is the improvement over upstream's shipped copy that this module exists for).
 * The port is ignored: the hostname is exact, so it is the real vendor either
 * way.
 */
const DIALECT_PATTERNS: readonly (readonly [WebhookDialect, readonly (readonly [string, string])[]])[] = [
  [
    "feishu",
    [
      ["open.feishu.cn", "/open-apis/bot/v2/hook/"],
      ["open.larksuite.com", "/open-apis/bot/v2/hook/"],
      ["open.larkoffice.com", "/open-apis/bot/v2/hook/"],
      ["www.larksuite.com", "/open-apis/bot/v2/hook/"],
    ],
  ],
  ["dingtalk", [["oapi.dingtalk.com", "/robot/send"]]],
  ["wecom", [["qyapi.weixin.qq.com", "/cgi-bin/webhook/send"]]],
  ["slack", [["hooks.slack.com", "/services/"]]],
] as const;

/** Upstream's `shorten` — hard cap with a visible ellipsis, never silent truncation. */
export function shortenWebhookText(value: string, limit = 4000): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

/**
 * Which vendor, if any, this URL belongs to. Anything that is not exactly one
 * of the hosts above, on its documented bot path, is `generic` — the internal
 * payload is posted untouched and signed if a secret is set.
 *
 * `generic` is the SAFE answer, so every uncertainty resolves to it: an
 * unparseable URL, a non-HTTPS scheme, a look-alike hostname, a vendor host on
 * some other path. Guessing a vendor wrong leaks a signature; guessing
 * `generic` wrong sends a body the receiver rejects, and that rejection is
 * recorded on the signal event.
 */
export function detectWebhookDialect(url: string): WebhookDialect {
  let parsed: URL;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    return "generic";
  }
  // The transport only ever posts https; a vendor claim on any other scheme is
  // not a vendor we recognise.
  if (parsed.protocol !== "https:") return "generic";
  const hostname = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  for (const [dialect, patterns] of DIALECT_PATTERNS) {
    for (const [vendorHost, pathPrefix] of patterns) {
      if (hostname === vendorHost && path.startsWith(pathPrefix)) return dialect;
    }
  }
  return "generic";
}

/**
 * Upstream's `format_float(max_decimals=10)`: full precision, then strip the
 * trailing zeros the fixed-point formatting added. A non-finite input has no
 * honest rendering, so it returns null and the caller omits the line entirely.
 */
export function formatWebhookNumber(value: number | null | undefined, maxDecimals = 10): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const fixed = value.toFixed(maxDecimals);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-0" ? "0" : trimmed;
}

/**
 * The internal payload a fired Quant Agent monitor produces. This is exactly
 * what a `generic` receiver gets on the wire; the vendor dialects distil it to
 * the title/body pair below.
 */
export interface WebhookSignalPayload {
  monitor_id: string;
  symbol: string;
  market?: string;
  interval: string;
  recommendation_id: string;
  /** BUY | SELL | HOLD. */
  decision?: string;
  direction: "buy" | "sell";
  entry: number | null;
  stop_loss: number;
  take_profit: number | null;
  confidence?: number | null;
  rationale?: string | null;
  /** Which firing rule let this through — `always` or `on_change`. */
  fire_rule?: string;
  /** The persisted signal-event row this delivery belongs to. */
  signal_event_id?: string;
  fired_at: string;
}

export interface WebhookText {
  title: string;
  body: string;
}

/**
 * Upstream's `build_webhook_text`, rebuilt over the fields a fired AiChart
 * monitor has. Absent levels are dropped rather than zero-filled: a webhook
 * body that prints `Take profit: 0` for a plan that has no take-profit is a
 * fabricated market number, and the receiver has no way to tell.
 */
export function buildWebhookText(payload: WebhookSignalPayload): WebhookText {
  const decision = (payload.decision || payload.direction || "").toUpperCase();
  const title = ["Quant Agent", payload.symbol, decision].filter((part) => Boolean(part)).join(" · ");

  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value == null || value === "") return;
    lines.push(`${label}: ${value}`);
  };

  push("Symbol", payload.symbol);
  push("Market", payload.market);
  push("Timeframe", payload.interval);
  push("Decision", decision || null);
  push("Entry", formatWebhookNumber(payload.entry));
  push("Stop loss", formatWebhookNumber(payload.stop_loss));
  push("Take profit", formatWebhookNumber(payload.take_profit));
  push(
    "Confidence",
    payload.confidence == null || !Number.isFinite(payload.confidence)
      ? null
      : `${Math.round(payload.confidence)}%`,
  );
  push("Monitor", payload.monitor_id);
  push("Rule", payload.fire_rule);
  push("Time", payload.fired_at);
  const rationale = (payload.rationale ?? "").trim();
  if (rationale) lines.push("", rationale);

  return { title, body: lines.join("\n") };
}

/**
 * Translate the internal payload to the vendor's required JSON schema.
 * Upstream's `adapt_payload_for_dialect`, verbatim in shape: Feishu takes
 * plain text, DingTalk and WeCom take markdown (each with its own envelope),
 * Slack takes bold-title text, and `generic` gets the untouched payload.
 */
export function adaptPayloadForDialect(
  dialect: WebhookDialect,
  payload: WebhookSignalPayload,
): unknown {
  const { title, body } = buildWebhookText(payload);

  if (dialect === "feishu") {
    return { msg_type: "text", content: { text: `${title}\n${shortenWebhookText(body)}` } };
  }
  if (dialect === "dingtalk") {
    return {
      msgtype: "markdown",
      markdown: {
        title: shortenWebhookText(title, 64),
        text: `### ${title}\n\n${shortenWebhookText(body)}`,
      },
    };
  }
  if (dialect === "wecom") {
    return {
      msgtype: "markdown",
      markdown: { content: `### ${title}\n\n${shortenWebhookText(body, 4000)}` },
    };
  }
  if (dialect === "slack") {
    return { text: `*${title}*\n${shortenWebhookText(body)}` };
  }
  return payload;
}

export interface VendorVerdict {
  ok: boolean;
  /** Machine-ish reason string, empty when `ok`. Stored on the signal event. */
  error: string;
}

/**
 * Whether the vendor actually accepted the message.
 *
 * Upstream's `check_vendor_response`. The two cases a naive `status < 300`
 * check gets wrong are both here: Feishu/DingTalk/WeCom answer 200 with an
 * error code in the body, and Slack answers 200 with the literal three-byte
 * body `ok` (which is not JSON, so the active upstream copy parses it to `{}`
 * and calls every Slack failure a success).
 */
export function checkVendorResponse(
  dialect: WebhookDialect,
  status: number,
  rawBody: string,
): VendorVerdict {
  const code = Number(status) || 0;
  const body = String(rawBody ?? "").trim();
  if (!(code >= 200 && code < 300)) {
    return { ok: false, error: `http_${code}:${shortenWebhookText(body, 300)}` };
  }

  if (dialect === "slack") {
    const ok = body.toLowerCase() === "ok" || body.startsWith("{");
    return ok ? { ok: true, error: "" } : { ok: false, error: `slack_unexpected:${shortenWebhookText(body, 300)}` };
  }

  if (dialect === "feishu" || dialect === "dingtalk" || dialect === "wecom") {
    // An empty or non-JSON 2xx from these vendors is a plain success; only a
    // JSON envelope carries a code worth reading.
    if (!body || !body.startsWith("{")) return { ok: true, error: "" };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return { ok: true, error: "" };
    }
    const raw = parsed.code ?? parsed.errcode ?? parsed.StatusCode;
    if (raw == null || raw === 0 || raw === "0") return { ok: true, error: "" };
    const message =
      (parsed.msg as string | undefined) ??
      (parsed.errmsg as string | undefined) ??
      (parsed.StatusMessage as string | undefined) ??
      body;
    return {
      ok: false,
      error: `${dialect}_error:code=${String(raw)}:${shortenWebhookText(String(message), 200)}`,
    };
  }

  return { ok: true, error: "" };
}

// --- Signing ---------------------------------------------------------------

/**
 * Feishu's documented in-body signature: the HMAC KEY is `"{ts}\n{secret}"`
 * and the MESSAGE is empty. It reads backwards, and it is correct — copying
 * the usual key/message order here produces a signature Feishu rejects.
 */
export function feishuSign(secret: string, timestampSeconds: number | string): string {
  const key = `${timestampSeconds}\n${secret}`;
  return createHmac("sha256", key).update("").digest("base64");
}

/** Feishu carries its signature inside the JSON body, not in a header. */
export function signFeishuPayload(
  adapted: unknown,
  secret: string,
  timestampSeconds: number,
): unknown {
  return {
    ...(adapted as Record<string, unknown>),
    timestamp: String(timestampSeconds),
    sign: feishuSign(secret, timestampSeconds),
  };
}

/**
 * DingTalk carries its signature in the URL query, over `"{ms}\n{secret}"`
 * keyed by the secret — the opposite arrangement to Feishu's.
 */
export function dingtalkSignedUrl(url: string, secret: string, nowMs: number = Date.now()): string {
  const timestamp = String(Math.trunc(nowMs));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}\n${secret}`)
    .digest("base64");
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}timestamp=${timestamp}&sign=${encodeURIComponent(signature)}`;
}

/** Header names carrying the generic signature. */
export const WEBHOOK_TIMESTAMP_HEADER = "X-AiChart-Timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "X-AiChart-Signature";

/**
 * The generic-receiver signature: lowercase hex
 * `HMAC-SHA256(secret, "{unix_seconds}." + <body bytes>)`.
 *
 * It takes BYTES, not an object, on purpose — the bytes signed must be the
 * bytes posted. Re-serializing the payload for the signature and again for the
 * request is how a signing implementation ends up signing a body that differs
 * from the one on the wire by a key order or a space, and every verification on
 * the receiving end then fails for reasons nobody can reproduce.
 */
export function signWebhookBody(
  secret: string,
  timestampSeconds: number | string,
  body: Buffer,
): string {
  return createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestampSeconds}.`, "utf8"), body]))
    .digest("hex");
}

/** Compact JSON, exactly as posted — `separators=(",", ":")`, non-ASCII kept. */
export function encodeWebhookBody(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload ?? {}), "utf8");
}
