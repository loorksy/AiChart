import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.join(import.meta.dirname, "..", "route.ts"),
  "utf8",
);

describe("live-capture upload ownership", () => {
  it("looks up the layout as the session user before completing an upload", () => {
    assert.match(SRC, /getChartLayoutById\(layoutId, user\.id\)/);
    assert.match(SRC, /getChartLayoutById\(ack\.data\.layout_id, user\.id\)/);
    assert.match(SRC, /getChartLayoutById\(upload\.data\.layout_id, user\.id\)/);
    assert.match(SRC, /error === "layout_not_owned"/);
    assert.match(SRC, /403/);
  });

  it("requires a logged-in session", () => {
    assert.match(SRC, /requireUser\(\)/);
  });
});
