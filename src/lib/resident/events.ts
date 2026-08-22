/**
 * The resident agent's event contract.
 *
 * ONE queue is the only path into the agent. Every way the world can poke
 * Lonora — a user typing on any channel, the clock, the market itself —
 * normalizes into one of exactly three event kinds before the agent sees it.
 * Channels, cron routes, and sweeps are producers; the resident host is the
 * single consumer. Nothing else may invoke the agent loop directly.
 *
 * The schema is the boundary: an event that does not validate is dropped with
 * a named error at publish time, never half-processed downstream.
 */
import { z } from "zod";

/** Redis Stream key carrying every resident event. */
export const RESIDENT_STREAM = "lonora:events";

/** Consumer group name — one group, one logical consumer (the host). */
export const RESIDENT_GROUP = "lonora-host";

/**
 * Channel identity, kept open-ended on purpose: adding WhatsApp later must be
 * a new adapter file plus a new string here — never a schema migration.
 */
export const channelRefSchema = z.object({
  /** "web" | "telegram" | future channel types. */
  type: z.string().min(1).max(24),
  /** Channel-native identifier (chat id, user id …) — resolved to a user. */
  id: z.string().min(1).max(128),
});
export type ChannelRef = z.infer<typeof channelRefSchema>;

export const userMessageEventSchema = z.object({
  kind: z.literal("user_message"),
  /** Resolved platform user. Channel adapters resolve BEFORE publishing. */
  userId: z.number().int().positive(),
  channel: channelRefSchema,
  text: z.string().min(1).max(8_000),
  /** Channel-native message reference for reply threading (optional). */
  messageRef: z.string().max(64).optional(),
  enqueuedAt: z.number().int().positive(),
});

export const scheduledTickEventSchema = z.object({
  kind: z.literal("scheduled_tick"),
  /** What this tick asks the host to do. */
  tick: z.enum(["recommendation_sweep", "candle_sync", "restart_check", "entitlement_sweep"]),
  enqueuedAt: z.number().int().positive(),
});

export const marketEventSchema = z.object({
  kind: z.literal("market_event"),
  /**
   * What happened in the market — the tracker's lifecycle vocabulary
   * (activation_triggered, target_hit, invalidation_hit, news_block_started…).
   */
  event: z.string().min(1).max(64),
  symbol: z.string().min(3).max(20),
  /** Owner of the affected recommendation, when the event is per-user. */
  userId: z.number().int().positive().optional(),
  recommendationId: z.string().max(64).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  enqueuedAt: z.number().int().positive(),
});

export const residentEventSchema = z.discriminatedUnion("kind", [
  userMessageEventSchema,
  scheduledTickEventSchema,
  marketEventSchema,
]);

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>;
export type ScheduledTickEvent = z.infer<typeof scheduledTickEventSchema>;
export type MarketEvent = z.infer<typeof marketEventSchema>;
export type ResidentEvent = z.infer<typeof residentEventSchema>;

/** Thrown when a producer hands the bus something outside the contract. */
export class InvalidResidentEventError extends Error {
  constructor(detail: string) {
    super(`Invalid resident event: ${detail}`);
    this.name = "InvalidResidentEventError";
  }
}

/** Validate at the boundary; returns the typed event or throws the named error. */
export function parseResidentEvent(raw: unknown): ResidentEvent {
  const parsed = residentEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidResidentEventError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}
