/**
 * The resident agent host.
 *
 * ONE long-lived process for the whole system. It boots, loads warm state
 * once, then sleeps on the event bus until something happens — a user
 * message from any channel, a scheduled tick, a market event. Events are
 * handled concurrently (async I/O; one host, many in-flight events), and the
 * host reports itself truthfully through a small health endpoint.
 *
 * The host owns lifecycle only. WHAT an event means is the AgentRunner's
 * business (the agent loop); HOW replies leave is a ChannelSender's business
 * (the channel adapters). Keeping those pluggable is what lets a new channel
 * be a new file and the agent loop evolve without touching process plumbing.
 */
import http from "node:http";
import { createLogger } from "@/lib/logger";
import type { EventBus } from "./bus";
import type {
  ChannelRef,
  MarketEvent,
  ResidentEvent,
  ScheduledTickEvent,
  UserMessageEvent,
} from "./events";
import { WarmStateStore } from "./warmState";

const log = createLogger("resident.host");

/** Outbound side of a channel. Adapters register one per channel type. */
export interface ChannelSender {
  sendText(channel: ChannelRef, text: string, opts?: { replyTo?: string }): Promise<void>;
  sendPhoto?(
    channel: ChannelRef,
    image: Buffer,
    caption?: string,
    opts?: { replyTo?: string },
  ): Promise<void>;
}

export interface AgentRunContext {
  warm: WarmStateStore;
  /** Resolve the sender for a channel; throws UnknownChannelError if unbound. */
  sender(type: string): ChannelSender;
  publish(event: ResidentEvent): Promise<string>;
}

/** The brain boundary. Phase 3 supplies the real loop. */
export interface AgentRunner {
  onUserMessage(event: UserMessageEvent, ctx: AgentRunContext): Promise<void>;
  onScheduledTick(event: ScheduledTickEvent, ctx: AgentRunContext): Promise<void>;
  onMarketEvent(event: MarketEvent, ctx: AgentRunContext): Promise<void>;
}

export class UnknownChannelError extends Error {
  constructor(type: string) {
    super(`No channel sender registered for "${type}"`);
    this.name = "UnknownChannelError";
  }
}

export interface HealthSnapshot {
  ok: boolean;
  startedAt: number;
  uptimeMs: number;
  warmState: { loaded: boolean; ageMs: number | null; openRecommendations: number | null };
  queue: { backend: string; pending: number; inFlight: number };
  events: { handled: number; failed: number; byKind: Record<string, number> };
  restart: { maxUptimeMs: number; restartDue: boolean };
}

export interface ResidentHostOptions {
  bus: EventBus;
  runner: AgentRunner;
  /** Event handler concurrency (async I/O fan-out). */
  concurrency?: number;
  healthPort?: number | null;
  /** Clean self-restart after this long (PM2 resurrects). 0 disables. */
  maxUptimeMs?: number;
  /** Injectable for tests: called for the self-restart exit. */
  exit?: (code: number) => void;
  /** Cadences for the ticks the host itself publishes. 0 disables one. */
  sweepEveryMs?: number;
  candleSyncEveryMs?: number;
  now?: () => number;
}

export class ResidentHost {
  readonly warm = new WarmStateStore();
  private readonly bus: EventBus;
  private readonly runner: AgentRunner;
  private readonly senders = new Map<string, ChannelSender>();
  private readonly persistHooks: Array<() => Promise<void>> = [];
  private readonly opts: Required<
    Pick<ResidentHostOptions, "concurrency" | "maxUptimeMs" | "sweepEveryMs" | "candleSyncEveryMs">
  > & { healthPort: number | null; exit: (code: number) => void; now: () => number };
  private startedAt = 0;
  private inFlight = 0;
  private handled = 0;
  private failed = 0;
  private byKind: Record<string, number> = {};
  private timers: NodeJS.Timeout[] = [];
  private server: http.Server | null = null;
  private stopping = false;

  constructor(options: ResidentHostOptions) {
    this.bus = options.bus;
    this.runner = options.runner;
    this.opts = {
      concurrency: options.concurrency ?? 8,
      healthPort: options.healthPort === undefined ? 8791 : options.healthPort,
      maxUptimeMs: options.maxUptimeMs ?? 24 * 60 * 60 * 1000,
      exit: options.exit ?? ((code) => process.exit(code)),
      sweepEveryMs: options.sweepEveryMs ?? 5 * 60 * 1000,
      candleSyncEveryMs: options.candleSyncEveryMs ?? 10 * 60 * 1000,
      now: options.now ?? (() => Date.now()),
    };
  }

  registerSender(type: string, sender: ChannelSender): void {
    this.senders.set(type, sender);
  }

  /** State that must land on disk before a shutdown completes. */
  onShutdownPersist(hook: () => Promise<void>): void {
    this.persistHooks.push(hook);
  }

  private context(): AgentRunContext {
    return {
      warm: this.warm,
      sender: (type: string) => {
        const sender = this.senders.get(type);
        if (!sender) throw new UnknownChannelError(type);
        return sender;
      },
      publish: (event) => this.bus.publish(event),
    };
  }

  async start(): Promise<void> {
    this.startedAt = this.opts.now();
    await this.warm.load();

    await this.bus.start(
      async ({ event }) => {
        this.inFlight += 1;
        try {
          await this.dispatch(event);
          this.handled += 1;
          this.byKind[event.kind] = (this.byKind[event.kind] ?? 0) + 1;
        } catch (err) {
          this.failed += 1;
          log.error("event failed", {
            kind: event.kind,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        } finally {
          this.inFlight -= 1;
        }
      },
      { concurrency: this.opts.concurrency },
    );

    this.startTickPublishers();
    if (this.opts.healthPort != null) await this.startHealthServer(this.opts.healthPort);
    log.info("resident host started", {
      backend: this.bus.backend,
      concurrency: this.opts.concurrency,
      healthPort: this.opts.healthPort,
    });
  }

  private async dispatch(event: ResidentEvent): Promise<void> {
    const ctx = this.context();
    switch (event.kind) {
      case "user_message":
        return this.runner.onUserMessage(event, ctx);
      case "market_event":
        return this.runner.onMarketEvent(event, ctx);
      case "scheduled_tick":
        if (event.tick === "restart_check") {
          this.maybeSelfRestart();
          return;
        }
        return this.runner.onScheduledTick(event, ctx);
    }
  }

  /**
   * Ticks are EVENTS the host publishes to its own queue, not work done on a
   * timer callback: the queue stays the only path into the agent, and a tick
   * competes fairly with user messages under the same concurrency.
   */
  private startTickPublishers(): void {
    const publishTick = (tick: ScheduledTickEvent["tick"]) => {
      this.bus
        .publish({ kind: "scheduled_tick", tick, enqueuedAt: this.opts.now() })
        .catch((err) =>
          log.warn("tick publish failed", {
            tick,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    };
    const schedule = (everyMs: number, tick: ScheduledTickEvent["tick"]) => {
      if (everyMs <= 0) return;
      const timer = setInterval(() => publishTick(tick), everyMs);
      timer.unref?.();
      this.timers.push(timer);
    };
    schedule(this.opts.sweepEveryMs, "recommendation_sweep");
    schedule(this.opts.candleSyncEveryMs, "candle_sync");
    if (this.opts.maxUptimeMs > 0) schedule(60_000, "restart_check");
  }

  private maybeSelfRestart(): void {
    if (this.opts.maxUptimeMs <= 0) return;
    const due = this.opts.now() - this.startedAt >= this.opts.maxUptimeMs;
    if (!due || this.stopping) return;
    log.info("self-restart due — draining for clean exit", {
      uptimeMs: this.opts.now() - this.startedAt,
    });
    void this.shutdown("self-restart").then(() => this.opts.exit(0));
  }

  async health(): Promise<HealthSnapshot> {
    const depth = await this.bus.depth();
    const warm = this.warm.loaded() ? this.warm.get() : null;
    return {
      ok: this.warm.loaded() && !this.stopping,
      startedAt: this.startedAt,
      uptimeMs: this.opts.now() - this.startedAt,
      warmState: {
        loaded: this.warm.loaded(),
        ageMs: this.warm.ageMs(this.opts.now()),
        openRecommendations: warm ? warm.openRecommendations.length : null,
      },
      queue: { backend: this.bus.backend, pending: depth.pending, inFlight: this.inFlight },
      events: { handled: this.handled, failed: this.failed, byKind: { ...this.byKind } },
      restart: {
        maxUptimeMs: this.opts.maxUptimeMs,
        restartDue:
          this.opts.maxUptimeMs > 0 &&
          this.opts.now() - this.startedAt >= this.opts.maxUptimeMs,
      },
    };
  }

  /** Bound health port (after start). Null when the server is disabled. */
  boundHealthPort(): number | null {
    const addr = this.server?.address();
    return addr && typeof addr === "object" ? addr.port : null;
  }

  private async startHealthServer(port: number): Promise<void> {
    this.server = http.createServer((req, res) => {
      if (req.url === "/healthz" || req.url === "/") {
        void this.health().then(
          (snapshot) => {
            res.writeHead(snapshot.ok ? 200 : 503, { "Content-Type": "application/json" });
            res.end(JSON.stringify(snapshot));
          },
          () => {
            res.writeHead(500);
            res.end();
          },
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, () => resolve());
    });
  }

  /** Drain in-flight events, run persist hooks, close everything. */
  async shutdown(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    log.info("shutting down", { reason, inFlight: this.inFlight });
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.bus.stop();
    const started = this.opts.now();
    while (this.inFlight > 0 && this.opts.now() - started < 30_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const hook of this.persistHooks) {
      await hook().catch((err) =>
        log.error("shutdown persist hook failed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    log.info("shutdown complete", { reason });
  }
}
