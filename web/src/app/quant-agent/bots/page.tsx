import { BotsClient } from "@/components/quantAgent/bots/BotsClient";

/**
 * `/quant-agent/bots` — the automated bot workbench. SIMULATION ONLY: a bot
 * here replays a configuration against historical candles and never places an
 * order (see `lib/quantAgent/bots/brokerPort.ts`).
 *
 * A trivial server component rendering one client component, matching
 * `/quant-agent` and `/quant-agent/analysis/history`. Auth, subscription
 * gating and the app shell all come from `quant-agent/layout.tsx`.
 */
export default function QuantAgentBotsPage() {
  return <BotsClient />;
}
