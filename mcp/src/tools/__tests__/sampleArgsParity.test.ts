import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { SAMPLE_ARGS, SKIP_EXEC_TOOLS } from "../sampleArgs.js";
import { TOOL_CATALOG } from "../schemas/index.js";

describe("MCP SAMPLE_ARGS ↔ TOOL_CATALOG schema parity", () => {
  it("provides validating canned args for previously failing tools", () => {
    for (const name of [
      "resolve_agent_skills",
      "load_agent_skill",
      "scan_market",
      "create_recommendation",
      "show_live_chart",
    ] as const) {
      const def = TOOL_CATALOG.find((t) => t.name === name);
      assert.ok(def, `${name} missing from TOOL_CATALOG`);
      assert.ok(SAMPLE_ARGS[name], `${name} missing SAMPLE_ARGS`);
      const schema = z.object(def.inputSchema);
      const parsed = schema.safeParse(SAMPLE_ARGS[name]);
      assert.equal(
        parsed.success,
        true,
        `${name} SAMPLE_ARGS must satisfy Zod inputSchema: ${
          parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))
        }`,
      );
    }
  });

  it("rejects the old invalid harness payloads that caused release NO-GO", () => {
    const resolveDef = TOOL_CATALOG.find((t) => t.name === "resolve_agent_skills")!;
    const loadDef = TOOL_CATALOG.find((t) => t.name === "load_agent_skill")!;
    const scanDef = TOOL_CATALOG.find((t) => t.name === "scan_market")!;

    assert.equal(z.object(resolveDef.inputSchema).safeParse({}).success, false);
    assert.equal(z.object(loadDef.inputSchema).safeParse({}).success, false);
    assert.equal(
      z
        .object(scanDef.inputSchema)
        .safeParse({ symbols: ["EURUSD", "GBPUSD"], market: "forex" }).success,
      false,
      "legacy scan_market payload without scope must fail",
    );
  });

  it("every SAMPLE_ARGS entry belongs to a registered tool and validates", () => {
    const byName = new Map(TOOL_CATALOG.map((t) => [t.name, t]));
    for (const [name, args] of Object.entries(SAMPLE_ARGS)) {
      const def = byName.get(name);
      assert.ok(def, `SAMPLE_ARGS has unknown tool ${name}`);
      const parsed = z.object(def.inputSchema).safeParse(args);
      assert.equal(
        parsed.success,
        true,
        `${name}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))}`,
      );
    }
  });

  it("create_recommendation is not in SKIP_EXEC and uses a WAIT host model_plan", () => {
    assert.equal(SKIP_EXEC_TOOLS.has("create_recommendation"), false);
    const plan = SAMPLE_ARGS.create_recommendation!.model_plan as {
      decision: string;
    };
    assert.equal(plan.decision, "wait");
  });

  it("show_live_chart SAMPLE_ARGS includes an explicit symbol for empty-layout RC users", () => {
    const args = SAMPLE_ARGS.show_live_chart!;
    assert.equal(typeof args.symbol, "string");
    assert.ok(String(args.symbol).length > 0);
  });
});
