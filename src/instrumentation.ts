/**
 * Next.js instrumentation hook — the src/ variant.
 *
 * This project keeps its app directory under `src/`, and in that layout
 * Next.js loads `src/instrumentation.ts` and IGNORES the root-level
 * `instrumentation.ts`. The root file had been carrying the DB init and
 * metrics sampler without ever running; the logic now lives here (the root
 * file simply re-exports for anything that imported it directly).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    const { initDb } = await import("./lib/db");
    await initDb();

    // Keep the inbound Telegram surface alive across deploys. The bot
    // token lives in platform_config; without this, a fresh process has
    // a working token and a deaf webhook.
    const { ensureTelegramWebhook } = await import("./lib/telegram");
    void ensureTelegramWebhook();

    // Event-loop lag sampler (RELIABILITY_PLAN.md item 9). Heavy synchronous
    // work starves the loop long before users report anything — the exact
    // pattern behind the research-service incident — so it is worth one cheap
    // unref'd timer per process. Import is dynamic to keep prom-client out of
    // any non-node runtime bundle.
    const { startEventLoopLagSampler } = await import("./lib/metrics");
    startEventLoopLagSampler();

    // In-process fallback scheduler (VPS/standalone): warms the candle
    // warehouse and sweeps tracked recommendations without depending on an
    // externally installed cron. Lease-locked, so it coexists safely with
    // external cron and multiple replicas. See lib/scheduler/internalScheduler.
    const { startInternalScheduler } = await import(
      "./lib/scheduler/internalScheduler"
    );
    startInternalScheduler();
  }
}
