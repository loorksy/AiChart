export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initDb } = await import("./src/lib/db");
    await initDb();

    // Event-loop lag sampler (RELIABILITY_PLAN.md item 9). Heavy synchronous
    // work starves the loop long before users report anything — the exact
    // pattern behind the research-service incident — so it is worth one cheap
    // unref'd timer per process. Import is dynamic to keep prom-client out of
    // any non-node runtime bundle.
    const { startEventLoopLagSampler } = await import("./src/lib/metrics");
    startEventLoopLagSampler();
  }
}
