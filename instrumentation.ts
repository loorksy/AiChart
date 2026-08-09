/**
 * Re-export of the real instrumentation hook.
 *
 * The app directory lives under `src/`, so Next.js loads
 * `src/instrumentation.ts` — this root file was never picked up. It stays as
 * a re-export so any tooling that referenced the root path keeps working,
 * with exactly one implementation underneath.
 */
export { register } from "./src/instrumentation";
