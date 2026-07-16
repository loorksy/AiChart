import assert from "node:assert/strict";
import { test } from "node:test";

test("metrics registry renders incremented counters in Prometheus format", async () => {
  const { metrics, renderMetrics } = await import("../metrics");
  metrics.executionDenials.inc({ code: "VALIDATION_ERROR" });
  metrics.tradesExecuted.inc({ broker: "mt5_local", market: "forex" });
  metrics.jobs.inc({ name: "opportunity_scan", status: "completed" });
  const out = await renderMetrics();
  assert.match(
    out,
    /aichart_execution_denials_total\{[^}]*code="VALIDATION_ERROR"[^}]*\}\s+1/,
  );
  assert.match(out, /aichart_trades_executed_total/);
  assert.match(out, /aichart_jobs_total/);
  // default process metrics are registered too
  assert.match(out, /process_cpu_user_seconds_total|nodejs_/);
});

test("captureError logs and resolves without a Sentry DSN (no throw)", async () => {
  delete process.env.SENTRY_DSN;
  const { captureError, errorReportingEnabled } = await import(
    "../errorReporting"
  );
  assert.equal(errorReportingEnabled(), false);
  // Must not throw even though Sentry is not configured.
  await captureError(new Error("boom"), { scope: "test" });
  await captureError("string error");
});
