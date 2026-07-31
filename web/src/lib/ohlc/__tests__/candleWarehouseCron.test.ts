import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The deployment schedule has to cover the code.
 *
 * This used to assert that TWO files each scheduled the warehouse job, which
 * enforced the duplication rather than the requirement — and the second file
 * drifted anyway, listing a job as required that is deliberately optional while
 * missing three that had been added. The installable file is now the only
 * source, and what is checked is the property that actually matters: a cron
 * route that exists in the code is either scheduled or explicitly documented as
 * optional.
 */
const CRON_FILE = fileURLToPath(new URL("../../../../../infra/aichart.cron", import.meta.url));
const EXAMPLE_FILE = fileURLToPath(
  new URL("../../../../../infra/crontab.example", import.meta.url),
);
const CRON_ROUTES_DIR = fileURLToPath(new URL("../../../app/api/cron", import.meta.url));

const cron = readFileSync(CRON_FILE, "utf8");

function cronRoutes(): string[] {
  return readdirSync(CRON_ROUTES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe("deployment cron schedule", () => {
  it("schedules candle-warehouse maintenance every 10 minutes", () => {
    assert.match(
      cron,
      /^\*\/10 \* \* \* \* (?:root )?curl .*?-X POST .*?\/api\/cron\/candle-warehouse(?:\s|$)/m,
    );
  });

  it("accounts for every cron route the code exposes", () => {
    const routes = cronRoutes();
    assert.ok(routes.length > 0, "no cron routes found — has the directory moved?");
    for (const route of routes) {
      const path = `/api/cron/${route}`;
      assert.ok(
        cron.includes(path),
        `${path} exists in the code but appears nowhere in infra/aichart.cron. ` +
          "Schedule it, or comment it out with a line saying why it is optional.",
      );
    }
  });

  it("keeps every scheduled line pointing at a route that exists", () => {
    const scheduled = new Set(
      [...cron.matchAll(/\/api\/cron\/([a-z-]+)/g)].map((match) => match[1]!),
    );
    const routes = new Set(cronRoutes());
    for (const name of scheduled) {
      assert.ok(
        routes.has(name),
        `infra/aichart.cron references /api/cron/${name}, which no longer exists — a dead cron entry`,
      );
    }
  });

  it("does not keep a second copy of the schedule", () => {
    // Two files describing one schedule is how the drift happened.
    const example = readFileSync(EXAMPLE_FILE, "utf8");
    const scheduleLines = example
      .split("\n")
      .filter((line) => /^\s*[\d*]/.test(line) && line.includes("/api/cron/"));
    assert.deepEqual(
      scheduleLines,
      [],
      "infra/crontab.example carries schedule lines again; it must point at infra/aichart.cron instead",
    );
    assert.ok(
      example.includes("infra/aichart.cron"),
      "crontab.example must name the file that holds the real schedule",
    );
  });
});
