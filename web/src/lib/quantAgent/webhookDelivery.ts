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
 */
import { randomUUID } from "node:crypto";
import * as dns from "node:dns/promises";
import * as https from "node:https";
import { createLogger } from "@/lib/logger";

const log = createLogger("quantAgent.webhookDelivery");

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4_096;

export interface MonitorWebhookPayload {
  monitor_id: string;
  symbol: string;
  interval: string;
  recommendation_id: string;
  direction: "buy" | "sell";
  entry: number | null;
  stop_loss: number;
  take_profit: number | null;
  fired_at: string;
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
      | "REQUEST_FAILED",
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

/**
 * POSTs a monitor-fire payload to a user-supplied HTTPS webhook. Best-effort:
 * never throws in a way that should be allowed to break the calling cron
 * tick — callers should catch and log, treating any rejection as a simple
 * "not delivered" the same way a Telegram/push failure already is.
 */
export async function deliverMonitorWebhook(url: string, payload: MonitorWebhookPayload): Promise<void> {
  const target = await resolveAndPin(url);
  const body = JSON.stringify(payload);
  const requestId = randomUUID();

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
        headers: {
          Host: target.hostname,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "AiChart-QuantAgent-Monitor/1.0",
          "X-Request-Id": requestId,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        // Body is never used — only the status matters — but the stream
        // must still be drained (bounded) so the socket can close cleanly
        // instead of leaking a half-read connection.
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) res.destroy();
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            reject(new WebhookDeliveryError(`Webhook responded with status ${status}.`, "REQUEST_FAILED"));
          }
        });
        res.on("error", () => resolve()); // status already observed; a body-drain error doesn't change the outcome
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new WebhookDeliveryError("Webhook request timed out.", "TIMEOUT"));
    });
    req.on("error", (error) => {
      reject(new WebhookDeliveryError(`Webhook request failed: ${error.message}`, "REQUEST_FAILED"));
    });

    req.write(body);
    req.end();
  }).catch((error) => {
    log.warn("quant_agent.monitor_webhook.delivery_failed", {
      requestId,
      code: error instanceof WebhookDeliveryError ? error.code : "UNKNOWN",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
}
