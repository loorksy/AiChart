/**
 * The unified event bus — the ONLY path into the resident agent.
 *
 * Two backends behind one interface:
 *
 *  - RedisStreamBus (production): a Redis Stream + one consumer group. The
 *    consumer BLOCKs on XREADGROUP, so the host wakes when an event arrives
 *    and sleeps otherwise — wake on event, not on a clock. Events are ACKed
 *    only after the handler resolves; entries another (crashed) consumer left
 *    pending are reclaimed on boot via XAUTOCLAIM, so a restart never loses
 *    an in-flight event.
 *
 *  - MemoryBus (dev / tests / REDIS_URL unset): same semantics in-process.
 *    Tests exercise host behaviour through it without a broker, mirroring the
 *    queue module's inline fallback philosophy.
 */
import { createLogger } from "@/lib/logger";
import {
  parseResidentEvent,
  RESIDENT_GROUP,
  RESIDENT_STREAM,
  type ResidentEvent,
} from "./events";

const log = createLogger("resident.bus");

export interface BusMessage {
  /** Backend-native id (stream entry id / memory sequence). */
  id: string;
  event: ResidentEvent;
  /** How many times this delivery has been attempted (reclaims count). */
  attempt: number;
}

export interface BusDepth {
  /** Events published but not yet ACKed (best effort per backend). */
  pending: number;
}

export interface EventBus {
  readonly backend: "redis-streams" | "memory";
  publish(event: ResidentEvent): Promise<string>;
  /**
   * Begin consuming. `handler` resolving ⇒ ACK; rejecting ⇒ the event stays
   * pending for reclaim (redis) / is re-queued once then dead-lettered (memory).
   */
  start(
    handler: (message: BusMessage) => Promise<void>,
    opts: { concurrency: number },
  ): Promise<void>;
  /** Stop pulling new events. In-flight handlers keep running. */
  stop(): Promise<void>;
  depth(): Promise<BusDepth>;
}

// ---------------------------------------------------------------------------
// Memory backend
// ---------------------------------------------------------------------------

export class MemoryBus implements EventBus {
  readonly backend = "memory" as const;
  private queue: BusMessage[] = [];
  private seq = 0;
  private running = false;
  private active = 0;
  private handler: ((m: BusMessage) => Promise<void>) | null = null;
  private concurrency = 1;
  private wake: (() => void) | null = null;
  private pumping = false;

  async publish(event: ResidentEvent): Promise<string> {
    const parsed = parseResidentEvent(event);
    const id = String(++this.seq);
    this.queue.push({ id, event: parsed, attempt: 1 });
    this.wake?.();
    // Deliver asynchronously even when start() was called after publish.
    void this.pump();
    return id;
  }

  async start(
    handler: (m: BusMessage) => Promise<void>,
    opts: { concurrency: number },
  ): Promise<void> {
    this.handler = handler;
    this.concurrency = Math.max(1, opts.concurrency);
    this.running = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.running && this.handler && this.queue.length > 0) {
        if (this.active >= this.concurrency) {
          await new Promise<void>((r) => {
            this.wake = r;
          });
          this.wake = null;
          continue;
        }
        const message = this.queue.shift()!;
        this.active += 1;
        void this.handler(message)
          .catch((err) => {
            // One retry, then drop with a loud log — memory backend is for
            // dev/tests where a durable dead-letter store adds nothing.
            if (message.attempt < 2) {
              this.queue.push({ ...message, attempt: message.attempt + 1 });
            } else {
              log.error("memory bus dead-letter", {
                id: message.id,
                kind: message.event.kind,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .finally(() => {
            this.active -= 1;
            this.wake?.();
            void this.pump();
          });
      }
    } finally {
      this.pumping = false;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
  }

  async depth(): Promise<BusDepth> {
    return { pending: this.queue.length + this.active };
  }

  /** Test seam: resolves once the queue is empty and no handler is active. */
  async idle(timeoutMs = 5_000): Promise<void> {
    const started = Date.now();
    while (this.queue.length > 0 || this.active > 0) {
      if (Date.now() - started > timeoutMs) {
        throw new Error("MemoryBus.idle timeout");
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

// ---------------------------------------------------------------------------
// Redis Streams backend
// ---------------------------------------------------------------------------

/** Entries idle this long in another consumer's PEL are reclaimed. */
const RECLAIM_MIN_IDLE_MS = 60_000;
/** Cap the stream so an unconsumed backlog cannot grow without bound. */
const STREAM_MAXLEN = 10_000;
/** How long one blocking read waits before re-checking shutdown. */
const BLOCK_MS = 5_000;

type Redis = import("ioredis").Redis;

export class RedisStreamBus implements EventBus {
  readonly backend = "redis-streams" as const;
  private readonly url: string;
  private readonly stream: string;
  private readonly group: string;
  private readonly consumer: string;
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private running = false;
  private active = 0;
  private loop: Promise<void> | null = null;

  constructor(opts?: { url?: string; stream?: string; group?: string; consumer?: string }) {
    this.url = opts?.url ?? process.env.REDIS_URL ?? "";
    this.stream = opts?.stream ?? RESIDENT_STREAM;
    this.group = opts?.group ?? RESIDENT_GROUP;
    this.consumer = opts?.consumer ?? `host-${process.pid}`;
    if (!this.url) throw new Error("RedisStreamBus requires REDIS_URL");
  }

  private async connect(kind: "pub" | "sub"): Promise<Redis> {
    const existing = kind === "pub" ? this.pub : this.sub;
    if (existing) return existing;
    const { default: IORedis } = await import("ioredis");
    const client = new IORedis(this.url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: true,
    });
    await client.connect();
    if (kind === "pub") this.pub = client;
    else this.sub = client;
    return client;
  }

  private async ensureGroup(client: Redis): Promise<void> {
    try {
      await client.xgroup("CREATE", this.stream, this.group, "0", "MKSTREAM");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("BUSYGROUP")) throw err;
    }
  }

  async publish(event: ResidentEvent): Promise<string> {
    const parsed = parseResidentEvent(event);
    const client = await this.connect("pub");
    await this.ensureGroup(client);
    const id = await client.xadd(
      this.stream,
      "MAXLEN",
      "~",
      String(STREAM_MAXLEN),
      "*",
      "event",
      JSON.stringify(parsed),
    );
    return id ?? "0-0";
  }

  async start(
    handler: (m: BusMessage) => Promise<void>,
    opts: { concurrency: number },
  ): Promise<void> {
    const client = await this.connect("sub");
    await this.ensureGroup(client);
    this.running = true;
    const concurrency = Math.max(1, opts.concurrency);

    const dispatch = async (id: string, fields: string[], attempt: number) => {
      const raw = fieldValue(fields, "event");
      this.active += 1;
      try {
        if (!raw) throw new Error("stream entry without event field");
        const event = parseResidentEvent(JSON.parse(raw));
        await handler({ id, event, attempt });
        await client.xack(this.stream, this.group, id);
      } catch (err) {
        // Malformed entries are ACKed away (poison-pill), real handler
        // failures stay pending for reclaim so a crash never loses work.
        const parseFailure =
          err instanceof SyntaxError || (err as Error)?.name === "InvalidResidentEventError";
        if (parseFailure) await client.xack(this.stream, this.group, id).catch(() => {});
        log.error("event handling failed", {
          id,
          parseFailure,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.active -= 1;
      }
    };

    this.loop = (async () => {
      // Boot pass: adopt entries a previous (crashed/restarted) consumer left.
      try {
        let cursor = "0-0";
        for (;;) {
          const res = (await client.xautoclaim(
            this.stream,
            this.group,
            this.consumer,
            String(RECLAIM_MIN_IDLE_MS),
            cursor,
            "COUNT",
            "16",
          )) as [string, [string, string[]][]] | null;
          if (!res) break;
          const [next, entries] = res;
          for (const [id, fields] of entries) await dispatch(id, fields, 2);
          if (!entries.length || next === "0-0") break;
          cursor = next;
        }
      } catch (err) {
        log.warn("xautoclaim pass failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      while (this.running) {
        if (this.active >= concurrency) {
          await new Promise((r) => setTimeout(r, 25));
          continue;
        }
        try {
          const batch = (await client.xreadgroup(
            "GROUP",
            this.group,
            this.consumer,
            "COUNT",
            String(Math.max(1, concurrency - this.active)),
            "BLOCK",
            String(BLOCK_MS),
            "STREAMS",
            this.stream,
            ">",
          )) as [string, [string, string[]][]][] | null;
          if (!batch) continue;
          for (const [, entries] of batch) {
            for (const [id, fields] of entries) void dispatch(id, fields, 1);
          }
        } catch (err) {
          if (!this.running) break;
          log.warn("xreadgroup failed; backing off", {
            error: err instanceof Error ? err.message : String(err),
          });
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop?.catch(() => {});
    this.loop = null;
    // Wait for in-flight dispatches to settle before closing connections.
    const started = Date.now();
    while (this.active > 0 && Date.now() - started < 30_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await this.sub?.quit().catch(() => {});
    await this.pub?.quit().catch(() => {});
    this.sub = null;
    this.pub = null;
  }

  async depth(): Promise<BusDepth> {
    try {
      const client = await this.connect("pub");
      const groups = (await client.xinfo("GROUPS", this.stream)) as unknown[];
      for (const entry of groups) {
        const fields = entry as unknown[];
        const map = new Map<string, unknown>();
        for (let i = 0; i + 1 < fields.length; i += 2) {
          map.set(String(fields[i]), fields[i + 1]);
        }
        if (map.get("name") === this.group) {
          const lag = Number(map.get("lag") ?? 0);
          const pel = Number(map.get("pending") ?? 0);
          return { pending: (Number.isFinite(lag) ? lag : 0) + (Number.isFinite(pel) ? pel : 0) };
        }
      }
      return { pending: 0 };
    } catch {
      return { pending: -1 };
    }
  }
}

function fieldValue(fields: string[], name: string): string | null {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === name) return fields[i + 1] ?? null;
  }
  return null;
}

/** The production choice: Redis Streams when configured, memory otherwise. */
export function createEventBus(): EventBus {
  if (process.env.REDIS_URL?.trim()) return new RedisStreamBus();
  log.warn("REDIS_URL unset — resident bus running in-memory (dev only)");
  return new MemoryBus();
}
