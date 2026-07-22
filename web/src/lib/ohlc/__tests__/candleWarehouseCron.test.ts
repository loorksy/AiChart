import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cronFiles = [
  new URL("../../../../../infra/aichart.cron", import.meta.url),
  new URL("../../../../../infra/crontab.example", import.meta.url),
];

test("both deployment crontabs schedule candle-warehouse maintenance", () => {
  for (const cronFile of cronFiles) {
    const cron = readFileSync(cronFile, "utf8");
    assert.match(
      cron,
      /^\*\/10 \* \* \* \* (?:root )?curl .*?-X POST .*?\/api\/cron\/candle-warehouse(?:\s|$)/m,
    );
  }
});
