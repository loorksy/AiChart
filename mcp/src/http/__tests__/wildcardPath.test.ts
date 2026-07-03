import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wildcardPath } from "../wildcardPath.js";

describe("wildcardPath", () => {
  it("joins Express 5 array segments", () => {
    assert.equal(wildcardPath({ path: ["account-overview", "v1"] }), "account-overview/v1");
  });

  it("passes through string paths", () => {
    assert.equal(wildcardPath({ path: "portfolio.html" }), "portfolio.html");
  });

  it("strips leading slashes on string paths", () => {
    assert.equal(wildcardPath({ path: "/analysis/v1" }), "analysis/v1");
  });
});
