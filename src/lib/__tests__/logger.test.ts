import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  console.warn = (...a: unknown[]) => lines.push(a.join(" "));
  console.error = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    fn();
  } finally {
    Object.assign(console, orig);
  }
  return lines;
}

test("JSON format emits one parseable object with scope, level and fields", async () => {
  process.env.LOG_FORMAT = "json";
  process.env.LOG_LEVEL = "info";
  const { createLogger } = await import("../logger");
  const lines = capture(() =>
    createLogger("cron:scalp").info("done", { sessions: 3 }),
  );
  assert.equal(lines.length, 1);
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj.level, "info");
  assert.equal(obj.scope, "cron:scalp");
  assert.equal(obj.msg, "done");
  assert.equal(obj.sessions, 3);
  assert.ok(obj.ts);
});

test("LOG_LEVEL filters lower-severity lines", async () => {
  process.env.LOG_FORMAT = "json";
  process.env.LOG_LEVEL = "warn";
  const { createLogger } = await import("../logger");
  const log = createLogger("x");
  const lines = capture(() => {
    log.info("hidden");
    log.warn("shown");
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /shown/);
});

test("child() merges persistent context fields", async () => {
  process.env.LOG_FORMAT = "json";
  process.env.LOG_LEVEL = "debug";
  const { createLogger } = await import("../logger");
  const lines = capture(() =>
    createLogger("api").child({ requestId: "r1" }).error("boom", { code: 5 }),
  );
  const obj = JSON.parse(lines[0]!);
  assert.equal(obj.requestId, "r1");
  assert.equal(obj.code, 5);
  assert.equal(obj.level, "error");
});
