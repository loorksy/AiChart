/**
 * Debug session logger — dual sink: local ingest + optional file append.
 * Set DEBUG_LOG_PATH=/path/to/debug-cdb263.log on server for VPS runs.
 */
export function debugSessionLog(payload: {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  runId?: string;
}): void {
  const entry = {
    sessionId: "cdb263",
    timestamp: Date.now(),
    ...payload,
  };
  // #region agent log
  fetch("http://127.0.0.1:7614/ingest/e6ab62b3-ec8e-4085-ada6-baad2d05d578", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "cdb263",
    },
    body: JSON.stringify(entry),
  }).catch(() => {});
  // #endregion
  const logPath = process.env.DEBUG_LOG_PATH?.trim();
  if (logPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* ignore */
    }
  }
}
