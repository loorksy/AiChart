import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  FEATURES,
  PHASE_FLAGS,
  featureFlagSnapshot,
} from "@/lib/agent/featureFlags";
import { clearPlatformConfigCache } from "@/lib/platformConfig";

/**
 * Flag reads are CACHED by platformConfig for the process lifetime, so the cache
 * has to be cleared between changes here. That is also true in production: an OS
 * environment change needs a restart, while a change through the admin platform
 * config clears the cache and takes effect live. Both are documented in
 * .env.example — this test exercises the cache-cleared path.
 */
function setFlag(env: string, value: string | undefined): void {
  if (value === undefined) delete process.env[env];
  else process.env[env] = value;
  clearPlatformConfigCache();
}

/**
 * Every phase named in the plan has a working rollback.
 *
 * The plan's only rollback mechanism is "turn the flag off" (§5). Eight of the
 * ten phases shipped with no flag at all, which meant eight phases that could
 * not be rolled back — the flag names existed only in the document. A flag whose
 * name is defined but which gates nothing is the same failure wearing a
 * disguise, so these tests check the reads AND that the gate is wired.
 */

const SRC = resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((path) => ({
  rel: path.slice(SRC.length + 1).split(sep).join("/"),
  text: readFileSync(path, "utf8"),
}));

/** Files that read a given FEATURES accessor, excluding the definition itself. */
function readersOf(accessor: string): string[] {
  return files
    .filter((file) => file.rel !== "lib/agent/featureFlags.ts")
    .filter((file) => new RegExp(`FEATURES\\.${accessor}\\(\\)`).test(file.text))
    .map((file) => file.rel);
}

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  clearPlatformConfigCache();
});

describe("phase flags exist for every phase in the plan", () => {
  it("covers all ten phases A–J", () => {
    assert.deepEqual(
      Object.keys(PHASE_FLAGS).sort(),
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      "a phase with no flag cannot be rolled back",
    );
  });

  it("defaults every phase ON, so a fresh deployment gets the built system", () => {
    for (const [phase, flag] of Object.entries(PHASE_FLAGS)) {
      assert.equal(flag.defaultOn, true, `phase ${phase} must default on`);
      setFlag(flag.env, undefined);
      assert.equal(flag.read(), true, `phase ${phase} must read ON with no env set`);
    }
  });

  it("turns each phase off from its own environment variable", () => {
    for (const [phase, flag] of Object.entries(PHASE_FLAGS)) {
      setFlag(flag.env, "0");
      assert.equal(flag.read(), false, `${flag.env}=0 must disable phase ${phase}`);
      setFlag(flag.env, "false");
      assert.equal(flag.read(), false, `${flag.env}=false must disable phase ${phase}`);
      setFlag(flag.env, "1");
      assert.equal(flag.read(), true, `${flag.env}=1 must enable phase ${phase}`);
      setFlag(flag.env, undefined);
    }
  });

  it("reports every flag in the debug snapshot", () => {
    const snapshot = featureFlagSnapshot();
    for (const accessor of [
      "agentDoctrineV3",
      "recRevisionsV1",
      "recLifecycleAlertsV1",
      "agentTradeModeV1",
      "visionDecisionV1",
      "patternAtlasV1",
      "caseMemoryV1",
      "evidencePipelineV2",
      "deepResearchV2",
      "performanceJournalV1",
      "reevaluationTriggersV1",
    ]) {
      assert.ok(accessor in snapshot, `${accessor} is missing from the snapshot`);
    }
  });
});

describe("each flag actually gates its phase", () => {
  /**
   * A flag with no reader is decoration. This is the check that would have
   * caught the original gap: the plan named eight flags and the code read none
   * of them.
   */
  const EXPECTED_GATES: Record<string, { minReaders: number; where: string[] }> = {
    agentDoctrineV3: { minReaders: 1, where: ["app/api/agent/recommendation/route.ts"] },
    recRevisionsV1: {
      minReaders: 2,
      where: ["lib/recommendations/canonical/repository.ts", "lib/execution.ts"],
    },
    recLifecycleAlertsV1: { minReaders: 1, where: ["lib/recommendations/lifecycleNotifier.ts"] },
    agentTradeModeV1: { minReaders: 1, where: ["lib/agent/tradeMode.ts"] },
    visionDecisionV1: { minReaders: 1, where: ["lib/agent/orchestrator.ts"] },
    patternAtlasV1: { minReaders: 1, where: ["lib/agent/skills/skillSelector.ts"] },
    caseMemoryV1: { minReaders: 1, where: ["lib/agent/orchestrator.ts"] },
    evidencePipelineV2: {
      minReaders: 1,
      where: ["lib/agent/agents/finalDecisionSynthesizer.ts"],
    },
    deepResearchV2: { minReaders: 1, where: ["lib/agent/deepAnalysis/completion.ts"] },
    performanceJournalV1: { minReaders: 1, where: ["lib/recommendations/performanceJournal.ts"] },
  };

  for (const [accessor, expectation] of Object.entries(EXPECTED_GATES)) {
    it(`${accessor} is read where its phase acts`, () => {
      const readers = readersOf(accessor);
      assert.ok(
        readers.length >= expectation.minReaders,
        `${accessor} has ${readers.length} reader(s); a flag that gates nothing cannot roll anything back`,
      );
      for (const expected of expectation.where) {
        assert.ok(
          readers.includes(expected),
          `${accessor} must gate ${expected}; readers are ${readers.join(", ") || "(none)"}`,
        );
      }
    });
  }
});

describe("rollback never makes stored data unreadable", () => {
  /**
   * The rule that makes rollback safe: a flag may stop a phase WRITING or
   * ACTING, never stop the system reading what the phase already wrote.
   * Otherwise turning a flag off to recover would hide history.
   */
  it("does not gate any read of the phase-B tables", () => {
    for (const rel of [
      "lib/recommendations/canonical/revisions.ts",
      "lib/recommendations/canonical/repository.ts",
    ]) {
      const file = files.find((candidate) => candidate.rel === rel);
      assert.ok(file, `${rel} moved — update this guard`);
      // Reading functions must not be behind the flag.
      for (const reader of ["getEffectiveRevision", "listRevisions", "getCanonicalRecommendation"]) {
        const declaration = new RegExp(
          `export async function ${reader}[\\s\\S]{0,600}?\\n\\}`,
        ).exec(file.text);
        if (!declaration) continue;
        assert.ok(
          !/FEATURES\./.test(declaration[0]),
          `${reader} must not be flag-gated: rollback would hide stored revisions`,
        );
      }
    }
  });

  it("keeps the journal read gated but non-throwing when off", async () => {
    // Off returns an empty journal rather than an error: the page still renders
    // and says there is nothing, instead of breaking.
    setFlag("PERFORMANCE_JOURNAL_V1", "0");
    assert.equal(FEATURES.performanceJournalV1(), false);
    const { buildPerformanceJournal } = await import(
      "@/lib/recommendations/performanceJournal"
    );
    const journal = await buildPerformanceJournal({ userId: 1 });
    assert.deepEqual(journal.entries, []);
    assert.equal(journal.summary.followed.count, 0);
  });

  it("forces advisory when the trade-mode phase is off", async () => {
    setFlag("AGENT_TRADE_MODE_V1", "0");
    const { getTradeMode, isAutoExecutionAuthorized } = await import("@/lib/agent/tradeMode");
    const view = await getTradeMode(1);
    assert.equal(view.mode, "advisory");
    assert.equal(view.downgradedReason, "phase_disabled");
    // And no standing grant can survive the phase being rolled back.
    assert.equal(await isAutoExecutionAuthorized(1), false);
  });
});

describe("documentation matches the flags", () => {
  it("names every phase flag in the env example", () => {
    const env = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    for (const [phase, flag] of Object.entries(PHASE_FLAGS)) {
      assert.ok(
        env.includes(flag.env),
        `${flag.env} (phase ${phase}) is missing from .env.example, so an operator cannot find it`,
      );
    }
  });
});
