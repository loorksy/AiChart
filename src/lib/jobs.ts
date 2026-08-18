/**
 * Job handler registrations. Imported (side-effecting) by the queue on first
 * use and by the worker process. Keep handlers thin: resolve inputs and call
 * the existing domain function so logic stays in one place.
 */
import { runMemoryLifecycle } from "./memoryLifecycle";
import { runOpportunityScanForUser } from "./opportunityScan";
import { hasHandler, registerHandler } from "./queue";

// Guarded so an explicitly pre-registered handler (e.g. in tests) is not
// clobbered when this side-effecting module is auto-imported.
if (!hasHandler("opportunity_scan")) {
  registerHandler("opportunity_scan", async ({ userId }) => {
    await runOpportunityScanForUser(userId);
  });
}

if (!hasHandler("memory_lifecycle")) {
  registerHandler("memory_lifecycle", async ({ userId, conversationId }) => {
    await runMemoryLifecycle(userId, conversationId);
  });
}

