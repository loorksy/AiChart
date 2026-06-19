/**
 * Standalone entry for the scalp worker (pm2: aichart-scalper). Runs the
 * continuous loop. Live execution requires SCALP_LIVE_ENABLED=1; otherwise it
 * runs in paper mode (logs decisions, places no orders).
 */
import { runScalpLoop } from "./worker";

const tick = Number(process.env.SCALP_TICK_MS) || 2000;

runScalpLoop(tick).catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[scalp] fatal:", e);
  process.exit(1);
});
