import assert from "node:assert/strict";
import { t } from "@/lib/i18n";
import { describe, it } from "node:test";
import {
  KNOWN_STAGES,
  aggregateStageEvents,
  type AgentStageEvent,
} from "@/lib/agent/stageEvents";

function ev(
  stage: string,
  status: AgentStageEvent["status"],
  durationMs?: number,
): AgentStageEvent {
  return { stage, status, durationMs, timestamp: 0 };
}

describe("stage event aggregation", () => {
  it("collapses running→done into one row per stage, in first-seen order", () => {
    const rows = aggregateStageEvents([
      ev("market_data", "running"),
      ev("structure", "running"),
      ev("market_data", "done", 420),
      ev("structure", "done", 1100),
    ]);
    assert.deepEqual(
      rows.map((r) => r.stage),
      ["market_data", "structure"],
    );
    assert.deepEqual(
      rows.map((r) => [r.status, r.durationMs]),
      [
        ["done", 420],
        ["done", 1100],
      ],
    );
  });

  it("a late stray 'running' never demotes a settled stage", () => {
    const rows = aggregateStageEvents([
      ev("news", "running"),
      ev("news", "failed", 8000),
      ev("news", "running"),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "failed");
  });

  it("keeps unfinished stages as running and tolerates unknown names", () => {
    const rows = aggregateStageEvents([
      ev("final_decision", "running"),
      ev("some_future_stage", "done", 5),
    ]);
    assert.equal(rows[0]!.status, "running");
    assert.equal(rows[0]!.durationMs, null);
    assert.equal(rows[1]!.stage, "some_future_stage");
  });

  it("resumed stages surface as resumed, and junk input is skipped", () => {
    const rows = aggregateStageEvents([
      ev("structure", "resumed"),
      { stage: "", status: "done", timestamp: 0 },
      null as unknown as AgentStageEvent,
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "resumed");
  });
});

describe("stage labels", () => {
  it("every known stage has an Arabic label — both surfaces read this list", () => {
    // The web trace and the Telegram progress bubble label stages through
    // `agent.stage.<name>`; a stage in the set without a dictionary entry
    // renders as its raw machine name on an operator's phone.
    for (const stage of KNOWN_STAGES) {
      const label = t("ar", `agent.stage.${stage}`);
      assert.notEqual(label, `agent.stage.${stage}`, `${stage} has no Arabic label`);
    }
  });
});
