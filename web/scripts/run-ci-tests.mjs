#!/usr/bin/env node
/**
 * Run every CI suite and report ALL failures.
 *
 * `npm run a && npm run b` stops at the first failure, which previously meant
 * a `test:research` flake hid `test:unit` (and the bot execution boundary
 * guards) entirely. This runner always continues and exits non-zero if any
 * suite failed.
 */
import { spawnSync } from "node:child_process";

const suites = [
  "test:context",
  "test:memory",
  "test:skills",
  "test:tools",
  "test:trace",
  "test:research",
  "test:recommendations",
  "test:trading-dna",
  "test:unit",
  "test:decision-authority",
  "test:execution",
  "test:integration",
  "test:isolation",
];

const failed = [];

for (const suite of suites) {
  console.log(`\n===== ${suite} =====\n`);
  const result = spawnSync("npm", ["run", suite], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    failed.push(suite);
    console.error(`\n[ci] ${suite} FAILED (exit ${result.status ?? "null"})\n`);
  }
}

if (failed.length > 0) {
  console.error(`\n[ci] failed suites: ${failed.join(", ")}\n`);
  process.exit(1);
}

console.log("\n[ci] all suites passed\n");
