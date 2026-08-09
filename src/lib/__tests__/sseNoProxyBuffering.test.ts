import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * nginx buffers proxied responses by default. A server-sent-events route that
 * does not send `X-Accel-Buffering: no` still works in `next dev` and still
 * passes every unit test — it only breaks behind the production reverse proxy,
 * where the whole stream is held back and delivered in one lump at the end.
 *
 * That is exactly what the live run-stage checklist looks like when it is
 * broken: the stages appear all at once instead of progressively, and it reads
 * as an agent that thought silently and then answered. The header is the fix
 * that travels with the app, so it is enforced here rather than left to the
 * server config.
 */

const APP = path.join(import.meta.dirname, "..", "..", "app");
const SSE_MARKER = "text/event-stream";
const OPT_OUT = "X-Accel-Buffering";

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test("every SSE route disables reverse-proxy buffering", () => {
  const offenders: string[] = [];

  for (const file of routeFiles(APP)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(SSE_MARKER)) continue;
    if (!text.includes(OPT_OUT)) {
      offenders.push(path.relative(APP, file).split(path.sep).join("/"));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These routes stream text/event-stream but never set ${OPT_OUT}: no — ` +
      `nginx will buffer them in production:\n  ${offenders.join("\n  ")}`,
  );
});
