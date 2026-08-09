/**
 * Statistical gate thresholds — a LEAF module with no imports.
 *
 * These constants are read by both server code (evidence.ts, which pulls in the
 * database) and by client-rendered code (the evidence card). Importing them
 * from `evidence.ts` dragged the whole DB layer into the browser bundle and
 * broke `next build` with a module-not-found on the SQLite driver — types are
 * erased at build time, but a VALUE import is not. Keeping the numbers in a
 * dependency-free module is what makes them safely shareable.
 *
 * Changing these is a governance decision, not a refactor: RELIABILITY_PLAN.md
 * lists lowering the 100-trade minimum under "must not change".
 */

/** Minimum historical trades before a backtest can back an execution-grade call. */
export const MIN_BACKTEST_TRADES = 100;
