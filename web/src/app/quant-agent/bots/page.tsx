import { BotsClient } from "@/components/quantAgent/bots/BotsClient";

/**
 * `/quant-agent/bots` — the automated bot workbench. Configure, replay, and
 * arm bots bot-by-bot. Live orders go through createIntent → executeIntent
 * (see `lib/quantAgent/bots/liveExecution.ts`).
 *
 * A trivial server component rendering one client component, matching
 * `/quant-agent` and `/quant-agent/analysis/history`. Auth, subscription
 * gating and the app shell all come from `quant-agent/layout.tsx`.
 */
export default function QuantAgentBotsPage() {
  return <BotsClient />;
}
