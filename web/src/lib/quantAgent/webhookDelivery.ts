/**
 * SSRF-hardened outbound webhook delivery for Quant Agent monitors (plan
 * §A5 — flagged as the highest-risk new component in the plan; this module
 * exists ONLY to POST a fire notification to a user-supplied HTTPS URL, and
 * every design choice below is a deliberate narrowing to make that safe:
 *
 *  - HTTPS only.
 *  - The hostname is resolved via `dns.lookup` and EVERY resolved address is
 *    validated as public (not private/loopback/link-local/multicast/
 *    reserved) BEFORE anything connects. Critically, the actual TCP
 *    connection then targets that SAME validated address directly (`https.
 *    request({host: <pinned ip>, ...})` with `servername` set to the
 *    original hostname for correct TLS SNI/cert validation) — it does NOT
 *    hand the hostname back to a second resolver call. Validating a hostname
 *    and then letting a normal fetch() re-resolve it is the classic DNS-
 *    rebinding gap (the attacker's DNS answers a public IP for the check and
 *    a private one moments later for the real connection); resolve-once-
 *    then-pin closes that.
 *  - No redirects are followed. `node:https` never follows redirects on its
 *    own, so this falls out of using it directly rather than `fetch()` —
 *    intentional, not an oversight (a 3xx to a private target would
 *    otherwise be a trivial SSRF bypass of the checks above).
 *  - Short hard timeout; response body is never read, only the status code.
 *  - The request payload never carries auth tokens or user PII beyond the
 *    symbol/direction/price fields a fired monitor already implies.
 *
 * This is genuinely new attack surface for the platform (every other
 * outbound call in this codebase targets an operator-configured, trusted
 * endpoint — an LLM provider, a broker, Telegram's API — never a URL a user
 * typed into a form). Treat any change here as security-sensitive.
 *
 * VENDOR DIALECTS were added on top of the above, and none of the protections
 * were relaxed to fit them:
 *  - The body is adapted per vendor (`notifications/webhookDialect.ts`), but
 *    the transport is unchanged: still `node:https`, still no redirects, still
 *    the pinned address with the original hostname for TLS.
 *  - DingTalk signs by appending query parameters, so the signed URL is built
 *    FIRST and `resolveAndPin` then runs on the URL that will actually be
 *    posted to. Validating one URL and posting another is precisely the gap
 *    this module exists to close, so the ordering is not an accident.
 *  - The response body is now read, because Slack answers `ok` and the Chinese
 *    vendors answer 200 with an error code inside the JSON — but it is read
 *    under the same `MAX_RESPONSE_BYTES` cap as before, and the socket is
 *    destroyed the moment that cap is reached.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/signal_notifier.py:704-853`
 * (`_notify_webhook`: dialect selection, per-dialect signing, "post the bytes
 * you signed"). What changed: the resolve-then-pin SSRF defense above has no
 * upstream counterpart at all (upstream hands a user-supplied URL straight to
 * `requests.post`); the single 1s retry on 429/5xx is NOT ported, because a
 * fired monitor already leaves a persisted signal-event row recording the
 * failure and a retry inside the cron tick spends the sweep's budget on one
 * user's unreachable endpoint; and there is no `discord` or `email` path.
 */
import { randomUUID } from "node:crypto";
import * as dns from "node:dns/promises";
import * as https from "node:https";
import { createLogger } from "@/lib/logger";
import {
  adaptPayloadForDialect,
  checkVendorResponse,
  detectWebhookDialect,
  dingtalkSignedUrl,
  encodeWebhookBody,
  signFeishuPayload,
  signWebhookBody,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookDialect,
  type WebhookSignalPayload,
} from "./notifications/webhookDialect";

const log = createLogger("quantAgent.webhookDelivery");

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4_096;

export type MonitorWebhookPayload = WebhookSignalPayload;

/**
 * Operator-configured shared secret for `generic` receivers (and the in-body /
 * in-URL signatures Feishu and DingTalk require). Unset means unsigned
 * delivery, which is the honest default: there is no per-monitor secret column
 * — a credential of that shape would need encrypting at rest and a UI to
 * manage, neither of which exists yet.
 */
function configuredSigningSecret(): string {
  return process.env.QUANT_AGENT_WEBHOOK_SIGNING_SECRET?.trim() ?? "";
}

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_URL"
      | "NOT_HTTPS"
      | "DNS_FAILED"
      | "PRIVATE_ADDRESS"
      | "NO_PUBLIC_ADDRESS"
      | "TIMEOUT"
      | "REQUEST_FAILED"
      | "VENDOR_REJECTED",
  ) {
    super(message);
    this.name = "WebhookDeliveryError";
  }
}

// --- IP-range validation -----------------------------------------------

function ipv4OctetsToInt(octets: number[]): number {
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function inIpv4Cidr(address: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const addrOctets = parseIpv4(address);
  const baseOctets = parseIpv4(base!);
  if (!addrOctets || !baseOctets) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4OctetsToInt(addrOctets) & mask) === (ipv4OctetsToInt(baseOctets) & mask);
}

/** Private, loopback, link-local, CGNAT, documentation/test-net, multicast, and reserved IPv4 ranges — anything that is not routable, ordinary public internet space. */
const BLOCKED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10", // carrier-grade NAT — frequently used for internal cloud metadata/service ranges
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local — includes cloud metadata endpoints (169.254.169.254)
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24", // TEST-NET-1
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved
  "255.255.255.255/32", // limited broadcast
];

/** Exported for direct unit testing of the IPv4 range table. */
export function isPublicIpv4(address: string): boolean {
  return !BLOCKED_IPV4_CIDRS.some((cidr) => inIpv4Cidr(address, cidr));
}

/** Extracts the embedded IPv4 from an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), else null. */
function ipv4MappedAddress(address: string): string | null {
  const match = address.toLowerCase().match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  return match ? match[1]! : null;
}

/** Exported for direct unit testing of the IPv6 range table. */
export function isPublicIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = ipv4MappedAddress(lower);
  if (mapped) return isPublicIpv4(mapped);
  if (lower === "::1" || lower === "::") return false; // loopback / unspecified
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return false; // link-local fe80::/10
  if (/^f[c-d][0-9a-f]{2}:/.test(lower)) return false; // unique local fc00::/7
  if (lower.startsWith("ff")) return false; // multicast ff00::/8
  return true;
}

function isPublicAddress(address: string, family: number): boolean {
  return family === 4 ? isPublicIpv4(address) : isPublicIpv6(address);
}

// --- Resolve-then-pin ----------------------------------------------------

interface PinnedTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
  port: number;
  path: string;
}

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<{ address: string; family: number }[]>;

const defaultLookup: DnsLookupFn = (hostname, options) => dns.lookup(hostname, options);

/**
 * Exported for direct unit testing of the validate-then-pin logic with an
 * injected `lookupFn` — the real network path (`deliverMonitorWebhook`)
 * always calls this with the real `dns.lookup`.
 */
export async function resolveAndPin(rawUrl: string, lookupFn: DnsLookupFn = defaultLookup): Promise<PinnedTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebhookDeliveryError("Malformed webhook URL.", "INVALID_URL");
  }
  if (parsed.protocol !== "https:") {
    throw new WebhookDeliveryError("Webhook URL must use https://.", "NOT_HTTPS");
  }

  let records: { address: string; family: number }[];
  try {
    records = await lookupFn(parsed.hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new WebhookDeliveryError(
      `DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      "DNS_FAILED",
    );
  }
  if (!records.length) {
    throw new WebhookDeliveryError("No addresses resolved for webhook host.", "NO_PUBLIC_ADDRESS");
  }

  // Every resolved address must be public — a hostname that resolves to
  // BOTH a public and a private address is exactly the DNS-rebinding setup
  // this module exists to defeat, so any private hit rejects the whole URL,
  // not just that one address.
  for (const record of records) {
    if (!isPublicAddress(record.address, record.family)) {
      throw new WebhookDeliveryError(
        `Webhook host resolves to a non-public address (${record.address}).`,
        "PRIVATE_ADDRESS",
      );
    }
  }

  const pinned = records[0]!;
  return {
    hostname: parsed.hostname,
    address: pinned.address,
    family: pinned.family === 6 ? 6 : 4,
    port: parsed.port ? Number(parsed.port) : 443,
    path: `${parsed.pathname}${parsed.search}` || "/",
  };
}

// --- Delivery --------------------------------------------------------------

export interface WebhookRequestPlan {
  dialect: WebhookDialect;
  /** The URL that will actually be posted to — DingTalk's carries its signature. */
  postUrl: string;
  /** The exact bytes on the wire. Whatever was signed, this is it. */
  body: Buffer;
  headers: Record<string, string | number>;
}

/**
 * Everything decided before a socket is opened: which vendor, what body, what
 * signature. Exported so the dialect + signing behaviour is testable without
 * DNS or TLS — the transport below consumes this and changes nothing about it.
 */
export function buildWebhookRequest(
  url: string,
  payload: MonitorWebhookPayload,
  options: { signingSecret?: string; nowMs?: number; requestId?: string } = {},
): WebhookRequestPlan {
  const dialect = detectWebhookDialect(url);
  const secret = (options.signingSecret ?? configuredSigningSecret()).trim();
  const nowMs = options.nowMs ?? Date.now();
  const timestampSeconds = Math.floor(nowMs / 1000);

  let adapted = adaptPayloadForDialect(dialect, payload);
  if (dialect === "feishu" && secret) {
    adapted = signFeishuPayload(adapted, secret, timestampSeconds);
  }
  // Serialize ONCE, after every mutation. Everything below reads these bytes.
  const body = encodeWebhookBody(adapted);

  const postUrl = dialect === "dingtalk" && secret ? dingtalkSignedUrl(url, secret, nowMs) : url;

  const headers: Record<string, string | number> = {
    "Content-Type": "application/json",
    "Content-Length": body.byteLength,
    "User-Agent": "AiChart-QuantAgent-Monitor/1.0",
    "X-Request-Id": options.requestId ?? randomUUID(),
  };
  if (dialect === "generic" && secret) {
    headers[WEBHOOK_TIMESTAMP_HEADER] = String(timestampSeconds);
    headers[WEBHOOK_SIGNATURE_HEADER] = signWebhookBody(secret, timestampSeconds, body);
  }
  // WeCom and Slack are deliberately unsigned: their secret is the URL itself.

  return { dialect, postUrl, body, headers };
}

/**
 * POSTs a monitor-fire payload to a user-supplied HTTPS webhook. Best-effort:
 * never throws in a way that should be allowed to break the calling cron
 * tick — callers should catch and log, treating any rejection as a simple
 * "not delivered" the same way a Telegram/push failure already is.
 */
export async function deliverMonitorWebhook(
  url: string,
  payload: MonitorWebhookPayload,
  options: { signingSecret?: string } = {},
): Promise<void> {
  const requestId = randomUUID();
  const plan = buildWebhookRequest(url, payload, { ...options, requestId });
  // Pin the URL that will be posted to, not the one that was passed in: for
  // DingTalk those differ (the signature rides in the query string).
  const target = await resolveAndPin(plan.postUrl);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        host: target.address,
        port: target.port,
        path: target.path,
        method: "POST",
        // TLS validates against the ORIGINAL hostname (correct cert/SNI
        // behavior) even though the socket connects to the pinned address.
        servername: target.hostname,
        headers: { Host: target.hostname, ...plan.headers },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        // The body IS read now — Slack answers with the literal string `ok`
        // and Feishu/DingTalk/WeCom answer 200 with an error code inside the
        // JSON, so a status-only check calls those failures successes. It is
        // still bounded by MAX_RESPONSE_BYTES and the socket is destroyed the
        // moment the cap is hit, so a hostile endpoint cannot stream at us.
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let received = 0;
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          const text = Buffer.concat(chunks).toString("utf8");
          const verdict = checkVendorResponse(plan.dialect, status, text);
          if (verdict.ok) {
            resolve();
            return;
          }
          reject(
            new WebhookDeliveryError(
              `Webhook rejected the delivery (${plan.dialect}): ${verdict.error}`,
              status >= 200 && status < 300 ? "VENDOR_REJECTED" : "REQUEST_FAILED",
            ),
          );
        };

        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          const room = MAX_RESPONSE_BYTES - received;
          if (chunk.length >= room) {
            if (room > 0) chunks.push(chunk.subarray(0, room));
            received = MAX_RESPONSE_BYTES;
            // Verdict first, then drop the socket: the promise is already
            // settled, so the `error` a destroy can raise is a no-op.
            finish();
            res.destroy();
            return;
          }
          chunks.push(chunk);
          received += chunk.length;
        });
        // `close` covers the destroyed-socket path; `error` still has a valid
        // status line, so it is judged on what was received rather than
        // silently treated as success.
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new WebhookDeliveryError("Webhook request timed out.", "TIMEOUT"));
    });
    req.on("error", (error) => {
      reject(new WebhookDeliveryError(`Webhook request failed: ${error.message}`, "REQUEST_FAILED"));
    });

    req.write(plan.body);
    req.end();
  }).catch((error) => {
    // The URL is never logged — a webhook URL is itself the credential for
    // WeCom and Slack. The dialect is enough to debug with.
    log.warn("quant_agent.monitor_webhook.delivery_failed", {
      requestId,
      dialect: plan.dialect,
      code: error instanceof WebhookDeliveryError ? error.code : "UNKNOWN",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
}
