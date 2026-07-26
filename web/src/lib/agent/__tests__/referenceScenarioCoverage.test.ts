/**
 * Machine-checked §16 coverage map.
 *
 * Fails when a registry scenario has no owner, an owner points at a missing
 * scenario, expected/forbidden results are incomplete, or a critical scenario
 * lacks an integration-class executable assertion.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REFERENCE_SCENARIOS } from "./fixtures/referenceScenarioPack";
import {
  CRITICAL_INTEGRATION_SCENARIOS,
  REFERENCE_SCENARIO_COVERAGE,
  coverageOwnersFor,
  registryScenarioIds,
} from "./fixtures/referenceScenarioCoverage";

const WEB_ROOT = process.cwd();

describe("reference scenario coverage map", () => {
  it("covers every registry scenario exactly once as a primary owner", () => {
    const registry = new Set(registryScenarioIds());
    const owned = new Set(REFERENCE_SCENARIO_COVERAGE.map((row) => row.scenarioId));

    const missing = [...registry].filter((id) => !owned.has(id));
    assert.deepEqual(
      missing,
      [],
      `Scenarios without a coverage owner: ${missing.join(", ")}`,
    );

    const orphans = [...owned].filter((id) => !registry.has(id));
    assert.deepEqual(
      orphans,
      [],
      `Coverage owners for unknown scenarios: ${orphans.join(", ")}`,
    );
  });

  it("requires expected result or operational block, plus forbidden outcomes", () => {
    for (const scenario of REFERENCE_SCENARIOS) {
      const hasExpected =
        scenario.expected.operationalBlock === true ||
        Object.keys(scenario.expected).length > 0;
      assert.ok(
        hasExpected,
        `${scenario.id} needs an expected result or operationalBlock`,
      );
      assert.ok(
        scenario.forbidden.length > 0,
        `${scenario.id} needs at least one forbidden outcome`,
      );
    }
  });

  it("points every owner at a real test file", () => {
    for (const owner of REFERENCE_SCENARIO_COVERAGE) {
      const full = join(WEB_ROOT, owner.testFile);
      assert.ok(existsSync(full), `missing test file for ${owner.scenarioId}: ${owner.testFile}`);
      assert.ok(owner.testName.trim(), `${owner.scenarioId} missing test name`);
      assert.ok(owner.kinds.length > 0, `${owner.scenarioId} missing coverage kinds`);
    }
  });

  it("requires integration owners for every critical scenario", () => {
    for (const id of CRITICAL_INTEGRATION_SCENARIOS) {
      const owners = coverageOwnersFor(id);
      assert.ok(owners.length > 0, `critical scenario ${id} has no owner`);
      const integration = owners.filter(
        (owner) =>
          owner.executableAssertion &&
          (owner.kinds.includes("integration") ||
            owner.kinds.includes("database") ||
            owner.kinds.includes("lifecycle") ||
            owner.kinds.includes("execution") ||
            owner.kinds.includes("parity")),
      );
      assert.ok(
        integration.length > 0,
        `critical scenario ${id} needs an integration/database/lifecycle owner, got: ${owners
          .map((o) => o.kinds.join("+"))
          .join(" | ")}`,
      );
    }
  });

  it("requires DB/lifecycle scenarios to own an integration test", () => {
    for (const scenario of REFERENCE_SCENARIOS) {
      const needsDb = Boolean(
        scenario.expectedDbRows?.recommendation ||
          scenario.expectedDbRows?.revision1 ||
          scenario.expectedDbRows?.alertDedupe ||
          scenario.expectedDbRows?.evidenceSnapshot ||
          scenario.expectedDbRows?.decisionTrace,
      );
      if (!needsDb) continue;
      const owners = coverageOwnersFor(scenario.id);
      const ok = owners.some(
        (owner) =>
          owner.executableAssertion &&
          (owner.kinds.includes("integration") ||
            owner.kinds.includes("database") ||
            owner.kinds.includes("lifecycle")),
      );
      assert.ok(
        ok,
        `${scenario.id} declares DB/lifecycle expectations but has no integration owner`,
      );
    }
  });
});
