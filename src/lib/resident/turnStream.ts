/**
 * The per-turn relay stream (Work B, approved design A2).
 *
 * One short-lived Redis Stream per web chat turn — `lonora:turn:<turnId>` —
 * carries every SSE event the worker emits, in order, so the web route can
 * relay it to the browser byte-for-byte and a dropped client can reconnect
 * from a cursor. Rules this module owns:
 *
 *  - Entries are either `sse` (name + JSON payload, relayed verbatim) or
 *    `ctl` (meta/end markers the relay consumes silently) — control never
 *    leaks into the SSE contract.
 *  - A turn is TERMINAL once the stream holds a `final` SSE event or an
 *    `end` control marker. The consumer checks this before running a
 *    redelivered (XAUTOCLAIM) turn: a duplicate run is a duplicate answer —
 *    and would be a duplicate charge if the ledger's UNIQUE key were ever
 *    weakened, so the guard refuses the rerun outright.
 *  - Every key expires: streams get a long TTL at open (covers the longest
 *    run) tightened to a short one at end; owner/cancel flags carry their
 *    own TTLs. Nothing under `lonora:turn:*` outlives cleanup.
 *  - Cancellation is an explicit flag key the worker polls — closing the
 *    tab never cancels; only the cancel button writes the flag.
 *
 * Every function takes an injectable minimal client so tests drive a fake
 * in-memory stream; production passes ioredis connections. Relay reads
 * BLOCK, so a relay must use a DEDICATED connection, never a shared one.
 */

export const TURN_STREAM_PREFIX = "lonora:turn:";
/** Stream TTL while a run may still be writing (longest tolerated run). */
export const TURN_STREAM_OPEN_TTL_S = 3_600;
/** Stream TTL once the turn ended — the resume/replay window. */
export const TURN_STREAM_DONE_TTL_S = 600;
/** Owner + cancel flag TTL. */
export const TURN_FLAG_TTL_S = 3_600;

export function turnStreamKey(turnId: string): string {
  return `${TURN_STREAM_PREFIX}${turnId}`;
}
export function turnOwnerKey(turnId: string): string {
  return `${TURN_STREAM_PREFIX}${turnId}:user`;
}
export function turnCancelKey(turnId: string): string {
  return `${TURN_STREAM_PREFIX}${turnId}:cancel`;
}

/**
 * The slice of a Redis client this module uses. ioredis satisfies it; tests
 * hand in an in-memory fake with the same shapes.
 */
export interface TurnStreamClient {
  xadd(key: string, ...args: Array<string | number>): Promise<string | null>;
  xrange(
    key: string,
    start: string,
    end: string,
    ...args: Array<string | number>
  ): Promise<Array<[string, string[]]>>;
  xread(
    ...args: Array<string | number>
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>;
  expire(key: string, seconds: number): Promise<number>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
}

/** A dedicated production connection (relay reads block — never share). */
export async function createTurnStreamClient(): Promise<TurnStreamClient> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) throw new Error("turn streams require REDIS_URL");
  const { default: IORedis } = await import("ioredis");
  const client = new IORedis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  await client.connect();
  return client as unknown as TurnStreamClient;
}

/** True when the web pipeline should ride the queue instead of run inline. */
export function turnQueueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export interface TurnEntry {
  id: string;
  /** SSE event name, or null for control entries. */
  event: string | null;
  /** Raw JSON payload for sse entries; control marker value for ctl. */
  data: string;
  ctl: string | null;
}

function parseEntry(id: string, fields: string[]): TurnEntry {
  let event: string | null = null;
  let data = "";
  let ctl: string | null = null;
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === "sse") event = fields[i + 1] ?? null;
    else if (fields[i] === "data") data = fields[i + 1] ?? "";
    else if (fields[i] === "ctl") ctl = fields[i + 1] ?? null;
  }
  return { id, event, data, ctl };
}

/** Record who this turn belongs to (resume/cancel authorization). */
export async function registerTurnOwner(
  client: TurnStreamClient,
  turnId: string,
  userId: number,
): Promise<void> {
  await client.set(turnOwnerKey(turnId), String(userId), "EX", TURN_FLAG_TTL_S);
}

export async function turnOwner(
  client: TurnStreamClient,
  turnId: string,
): Promise<number | null> {
  const raw = await client.get(turnOwnerKey(turnId));
  const parsed = Number(raw);
  return raw != null && Number.isFinite(parsed) ? parsed : null;
}

/** The explicit cancel button — the ONLY thing that cancels a queued turn. */
export async function requestTurnCancel(
  client: TurnStreamClient,
  turnId: string,
): Promise<void> {
  await client.set(turnCancelKey(turnId), "1", "EX", TURN_FLAG_TTL_S);
}

export async function isTurnCancelRequested(
  client: TurnStreamClient,
  turnId: string,
): Promise<boolean> {
  return (await client.get(turnCancelKey(turnId))) === "1";
}

/**
 * The XAUTOCLAIM redelivery guard: has this turn already reached a terminal
 * state? True when the stream holds a `final` SSE event OR an `end` control
 * marker (a cancelled turn ends with the marker and no final — still
 * terminal, still must not rerun).
 */
export async function hasTurnTerminal(
  client: TurnStreamClient,
  turnId: string,
): Promise<boolean> {
  const entries = await client.xrange(turnStreamKey(turnId), "-", "+");
  for (const [id, fields] of entries) {
    const entry = parseEntry(id, fields);
    if (entry.event === "final" || entry.ctl === "end") return true;
  }
  return false;
}

export type TurnEndStatus = "final" | "cancelled" | "failed";

/**
 * The worker side: appends SSE events during the run, then closes the turn
 * with an end marker and tightens the TTL to the replay window.
 */
export class TurnStreamWriter {
  constructor(
    private readonly client: TurnStreamClient,
    private readonly turnId: string,
  ) {}

  /** First write: a meta marker plus the open TTL. */
  async open(userId: number): Promise<void> {
    await this.client.xadd(
      turnStreamKey(this.turnId),
      "*",
      "ctl",
      "meta",
      "data",
      JSON.stringify({ user: userId }),
    );
    await this.client.expire(turnStreamKey(this.turnId), TURN_STREAM_OPEN_TTL_S);
  }

  async append(event: string, data: unknown): Promise<void> {
    await this.client.xadd(
      turnStreamKey(this.turnId),
      "*",
      "sse",
      event,
      "data",
      JSON.stringify(data),
    );
  }

  async end(status: TurnEndStatus): Promise<void> {
    await this.client.xadd(
      turnStreamKey(this.turnId),
      "*",
      "ctl",
      "end",
      "data",
      status,
    );
    await this.client.expire(turnStreamKey(this.turnId), TURN_STREAM_DONE_TTL_S);
  }
}

export interface RelayFrame {
  /** Stream entry id — the client's resume cursor (SSE `id:` line). */
  id: string;
  event: string;
  /** Raw JSON exactly as the worker wrote it. */
  data: string;
}

export interface RelayResult {
  /** Why the relay stopped. */
  reason: "ended" | "aborted" | "timeout";
  /** Last entry id relayed (resume cursor). */
  cursor: string;
}

/** Longest a single relay connection stays open before the client re-attaches. */
const RELAY_MAX_LIFETIME_MS = 12 * 60 * 1000;
const RELAY_BLOCK_MS = 5_000;

/**
 * The web-route side: follow one turn stream from `cursor` (exclusive;
 * "0" = from the start) and hand each SSE entry to `onFrame` in order.
 * Control entries are consumed silently; the `end` marker stops the relay.
 * The SSE contract is untouched — this only moves frames.
 */
export async function relayTurnStream(opts: {
  client: TurnStreamClient;
  turnId: string;
  cursor?: string;
  signal?: AbortSignal;
  onFrame: (frame: RelayFrame) => void | Promise<void>;
  maxLifetimeMs?: number;
}): Promise<RelayResult> {
  const key = turnStreamKey(opts.turnId);
  let cursor = opts.cursor ?? "0";
  const deadline = Date.now() + (opts.maxLifetimeMs ?? RELAY_MAX_LIFETIME_MS);
  for (;;) {
    if (opts.signal?.aborted) return { reason: "aborted", cursor };
    if (Date.now() >= deadline) return { reason: "timeout", cursor };
    const batch = await opts.client.xread(
      "COUNT",
      64,
      "BLOCK",
      RELAY_BLOCK_MS,
      "STREAMS",
      key,
      cursor,
    );
    if (!batch) continue;
    for (const [, entries] of batch) {
      for (const [id, fields] of entries) {
        cursor = id;
        const entry = parseEntry(id, fields);
        if (entry.ctl === "end") return { reason: "ended", cursor };
        if (entry.ctl != null) continue;
        if (!entry.event) continue;
        await opts.onFrame({ id, event: entry.event, data: entry.data });
      }
    }
  }
}
