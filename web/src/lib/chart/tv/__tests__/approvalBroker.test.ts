import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  TV_BROKER_APPROVAL_ENDPOINT,
  TV_BROKER_FORBIDDEN,
} from "../approvalBroker";

const src = readFileSync(
  join(__dirname, "../approvalBroker.ts"),
  "utf8",
);

describe("TV approval broker — never direct open_trade", () => {
  it("places only through the approval endpoint", () => {
    assert.equal(TV_BROKER_APPROVAL_ENDPOINT, "/api/trades/request-approval");
    assert.match(src, /fetch\(\s*TV_BROKER_APPROVAL_ENDPOINT/);
    // Exactly one fetch in the adapter.
    assert.equal((src.match(/fetch\s*\(/g) ?? []).length, 1);
  });

  it("documents forbidden execution paths and does not fetch them", () => {
    assert.ok(TV_BROKER_FORBIDDEN.includes("open_trade"));
    assert.ok(TV_BROKER_FORBIDDEN.includes("/api/agent/trade/open"));
    // Strip the forbidden-list declaration so we only inspect call sites.
    const withoutList = src.replace(
      /export const TV_BROKER_FORBIDDEN[\s\S]*?\] as const;/,
      "",
    );
    for (const forbidden of TV_BROKER_FORBIDDEN) {
      assert.equal(
        withoutList.includes(forbidden),
        false,
        `broker call sites must not mention ${forbidden}`,
      );
    }
  });
});
