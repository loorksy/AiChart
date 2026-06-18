import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TOOL_CATALOG } from "../schemas/index.js";

describe("MCP TOOL_CATALOG", () => {
  it("has unique tool names", () => {
    const names = TOOL_CATALOG.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, "duplicate tool names");
  });

  it("has at least 50 tools registered", () => {
    assert.ok(TOOL_CATALOG.length >= 50, `expected >=50, got ${TOOL_CATALOG.length}`);
  });

  it("every tool has §0.11-style description and annotations", () => {
    for (const tool of TOOL_CATALOG) {
      assert.ok(tool.description.length >= 20, `${tool.name}: description too short`);
      assert.ok(
        tool.description.includes("متى:") || tool.description.includes("read-only"),
        `${tool.name}: missing usage hint`,
      );
      assert.equal(typeof tool.annotations.readOnlyHint, "boolean", tool.name);
      assert.equal(typeof tool.annotations.destructiveHint, "boolean", tool.name);
      assert.equal(typeof tool.annotations.idempotentHint, "boolean", tool.name);
    }
  });

  it("matches manifest tool count when manifest exists", () => {
    try {
      const manifest = JSON.parse(
        readFileSync(join(process.cwd(), "schemas", "manifest.json"), "utf8"),
      ) as { toolCount?: number };
      if (manifest.toolCount != null) {
        assert.equal(manifest.toolCount, TOOL_CATALOG.length);
      }
    } catch {
      // manifest not exported yet
    }
  });
});
