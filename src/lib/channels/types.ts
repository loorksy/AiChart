/**
 * Channel contracts — the seam between messaging surfaces and the resident
 * agent.
 *
 * A channel adapter has exactly two jobs and no third:
 *
 *  1. **Normalize inbound** — turn the platform's raw update into either a
 *     mechanical action it can answer itself (linking, a chart photo, a
 *     settings menu: things that are about the CHANNEL, not the market) or a
 *     `user_message` resident event for the agent.
 *  2. **Format outbound** — deliver the agent's words and images in the
 *     channel's native shape, as a `ChannelSender` registered on the
 *     resident host.
 *
 * Zero agent logic lives behind this seam: no orchestrator, no gates, no
 * model calls. Adding a channel (WhatsApp, say) means one new directory
 * under `src/lib/channels/<name>/` implementing these contracts and one
 * `registerSender` call — never a refactor of the agent.
 */
import type { ChannelRef, UserMessageEvent } from "@/lib/resident/events";
import type { ChannelSender } from "@/lib/resident/host";

export type { ChannelRef, ChannelSender };

/** The normalized inbound message every channel reduces its updates to. */
export interface InboundChannelMessage {
  channel: ChannelRef;
  text: string;
  /** Channel-native message id, for reply-quoting. */
  messageRef?: string;
}

/**
 * What one inbound update became. `handled` means the adapter answered the
 * mechanical part itself (link flows, menus, chart photos); `agent` means a
 * resident `user_message` event was published for the agent; `ignored` means
 * the update carried nothing this channel answers.
 */
export type InboundDispatchOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "handled"; action: string }
  | { kind: "agent"; event: UserMessageEvent };
