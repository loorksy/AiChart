/**
 * Channel registry — every outbound channel the resident agent can speak
 * through, in one place. Both resident hosts (the worker process and the
 * dev in-process host) register from here, so a channel added for one is
 * never silently missing from the other.
 */
import type { ResidentHost } from "@/lib/resident/host";
import { telegramChannelSender } from "./telegram/adapter";

export function registerAllChannelSenders(host: ResidentHost): void {
  host.registerSender("telegram", telegramChannelSender());
}
