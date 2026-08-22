/**
 * Phase B structural guard: the client-plan gate path is LLM-free BY IMPORT
 * GRAPH, not just by the absence of a call in today's code.
 *
 * The functional test proves a run makes zero network calls; this one proves
 * the property survives refactors: neither the chain module nor its bridge
 * route can even NAME the platform's model gateway, the synthesizer, the
 * embedding client, or the resident loop. The day someone wires one in, this
 * fails with the exact import chain that did it.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  chainTo,
  walkValueImports,
} from "@/lib/__tests__/helpers/importGraph";

const ROOT = process.cwd();
const abs = (p: string) => path.join(ROOT, p);

/** Every place platform model spend (or its trigger) lives. */
const LLM_TERRITORY = [
  "src/lib/llm.ts",
  "src/lib/embeddings.ts",
  "src/lib/agent/agents/finalDecisionSynthesizer.ts",
  "src/lib/agent/agents/finalDecisionAgent.ts",
  "src/lib/agent/orchestrator.ts",
  "src/lib/resident/agentLoop.ts",
];

const ZERO_SPEND_ROOTS = [
  "src/lib/agent/gates/clientPlanChain.ts",
  "src/app/api/agent/gates/run/route.ts",
];

describe("MCP zero-spend path never reaches LLM territory", () => {
  it("the client-plan chain and its route import no model gateway, synthesizer, embedding client, or agent loop", () => {
    const walk = walkValueImports(ZERO_SPEND_ROOTS.map(abs));
    assert.ok(
      walk.reachable.size > 20,
      `the walk found only ${walk.reachable.size} files — the resolver is broken, not the code clean`,
    );
    const offences = LLM_TERRITORY.map(abs)
      .filter((file) => walk.reachable.has(file))
      .map((file) => chainTo(walk, file));
    assert.deepEqual(
      offences,
      [],
      `the zero-spend path reaches LLM territory:\n${offences.join("\n")}`,
    );
  });
});
