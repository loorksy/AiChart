import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  checkExecutionHalt,
  isKillSwitchEngaged,
  isLiveDualEnabled,
  isLiveTradingEnvironment,
  reconcileAtStartup,
} from "@/lib/executionKillSwitch";

const ENV_KEYS = ["TRADING_KILL_SWITCH", "LIVE_TRADING_ENABLED", "OANDA_ENV"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("master kill switch (item 11)", () => {
  it("engages from either the env switch or the ops flag", () => {
    delete process.env.TRADING_KILL_SWITCH;
    assert.equal(isKillSwitchEngaged(null), false);
    assert.equal(isKillSwitchEngaged("1"), true, "ops flag alone must stop trading");
    process.env.TRADING_KILL_SWITCH = "1";
    assert.equal(isKillSwitchEngaged(null), true, "env alone must stop trading");
  });

  it("accepts the usual truthy spellings, ignores everything else", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE"]) {
      assert.equal(isKillSwitchEngaged(v), true, v);
    }
    for (const v of ["0", "false", "", "no", "maybe"]) {
      assert.equal(isKillSwitchEngaged(v), false, v);
    }
  });

  it("blocks execution before any other consideration", () => {
    const halt = checkExecutionHalt({
      killSwitchFlag: "1",
      isLive: false,
      liveEnvEnabled: true,
      liveRuntimeEnabled: true,
      expectedAccountId: "A",
      brokerAccountId: "A",
    });
    assert.equal(halt.halted, true);
    assert.equal(halt.halted && halt.code, "kill_switch");
  });
});

describe("dual enablement for live execution", () => {
  it("requires BOTH switches — neither alone is enough", () => {
    assert.equal(isLiveDualEnabled({ envEnabled: true, runtimeEnabled: false }), false);
    assert.equal(isLiveDualEnabled({ envEnabled: false, runtimeEnabled: true }), false);
    assert.equal(isLiveDualEnabled({ envEnabled: true, runtimeEnabled: true }), true);
  });

  it("halts a live execution when only one switch is set", () => {
    const halt = checkExecutionHalt({
      isLive: true,
      liveEnvEnabled: true,
      liveRuntimeEnabled: false,
    });
    assert.equal(halt.halted, true);
    assert.equal(halt.halted && halt.code, "live_not_dual_enabled");
  });

  it("does not gate demo/practice execution", () => {
    const check = checkExecutionHalt({
      isLive: false,
      liveEnvEnabled: false,
      liveRuntimeEnabled: false,
    });
    assert.equal(check.halted, false, "demo must not need live dual enablement");
  });

  it("treats an unknown environment as LIVE (stricter, never looser)", () => {
    delete process.env.OANDA_ENV;
    assert.equal(isLiveTradingEnvironment(), true, "unknown env must require dual enablement");
    process.env.OANDA_ENV = "practice";
    assert.equal(isLiveTradingEnvironment(), false);
    process.env.OANDA_ENV = "live";
    assert.equal(isLiveTradingEnvironment(), true);
  });
});

describe("account-identity halt", () => {
  it("halts when the broker account differs from the expected one", () => {
    const halt = checkExecutionHalt({
      isLive: false,
      expectedAccountId: "101-004-1",
      brokerAccountId: "101-004-9",
    });
    assert.equal(halt.halted, true);
    assert.equal(halt.halted && halt.code, "account_mismatch");
  });

  it("passes when identities match", () => {
    const check = checkExecutionHalt({
      isLive: false,
      expectedAccountId: "101-004-1",
      brokerAccountId: "101-004-1",
    });
    assert.equal(check.halted, false);
  });

  it("does not invent a mismatch when an id is unknown", () => {
    assert.equal(
      checkExecutionHalt({ isLive: false, expectedAccountId: "A", brokerAccountId: null }).halted,
      false,
      "an unknown id is handled by readiness checks, not a fabricated mismatch",
    );
  });
});

describe("startup reconciliation", () => {
  it("halts execution when the account identity cannot be confirmed", () => {
    const report = reconcileAtStartup({
      expectedAccountId: "A",
      brokerAccountId: null,
      localOpenPositionIds: [],
      brokerOpenPositionIds: [],
    });
    assert.equal(report.accountMatches, false);
    assert.equal(report.haltExecution, true, "unknown identity must halt, not assume");
  });

  it("reports position drift in both directions without halting on it", () => {
    const report = reconcileAtStartup({
      expectedAccountId: "A",
      brokerAccountId: "A",
      localOpenPositionIds: ["p1", "p2"],
      brokerOpenPositionIds: ["p2", "p3"],
    });
    assert.equal(report.accountMatches, true);
    assert.equal(report.unknownBrokerPositions, 1, "p3 is unknown to the platform");
    assert.equal(report.missingLocalPositions, 1, "p1 is not reported by the broker");
    assert.equal(report.haltExecution, false, "drift is reported, not a hard stop");
    assert.ok(report.notes.length >= 2);
  });

  it("is clean when both sides agree", () => {
    const report = reconcileAtStartup({
      expectedAccountId: "A",
      brokerAccountId: "A",
      localOpenPositionIds: ["p1"],
      brokerOpenPositionIds: ["p1"],
    });
    assert.equal(report.haltExecution, false);
    assert.deepEqual(report.notes, []);
  });
});
