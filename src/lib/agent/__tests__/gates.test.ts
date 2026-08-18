/**
 * The mandatory gate chain.
 *
 * The invariants under test are the ones that make a gate different from an
 * opinion: order, short-circuiting, and — the one that matters most — that a
 * gate which could not run is never mistaken for a gate that passed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runGateChain, refusalSummaryAr } from "../gates/chain";
import type { GateDefinition } from "../gates/chain";
import { evaluateNewsWindow, newsBlockReasonAr } from "../gates/newsWindow";
import { revalidatePlan } from "../gates/revalidation";
import { GATE_IDS } from "../gates/types";
import type { GateId } from "../gates/types";

const pass = (id: GateId): GateDefinition => ({
  id,
  run: async () => ({ status: "pass" }),
});

describe("gate chain ordering and short-circuiting", () => {
  it("runs every gate in order when all pass", async () => {
    const ran: GateId[] = [];
    const gates = GATE_IDS.map((id) => ({
      id,
      run: async () => {
        ran.push(id);
        return { status: "pass" as const };
      },
    }));
    const result = await runGateChain(gates);
    assert.deepEqual(ran, [...GATE_IDS]);
    assert.equal(result.allowed, true);
    assert.equal(result.verdicts.length, 7);
  });

  it("stops at the first veto and never runs the rest", async () => {
    const ran: GateId[] = [];
    const gates: GateDefinition[] = GATE_IDS.map((id) => ({
      id,
      run: async () => {
        ran.push(id);
        return id === "G3"
          ? { status: "veto" as const, reasonAr: "منطقة مستهلكة" }
          : { status: "pass" as const };
      },
    }));
    const result = await runGateChain(gates);
    assert.deepEqual(ran, ["G1", "G2", "G3"], "gates after the veto must not run");
    assert.equal(result.allowed, false);
    assert.equal(result.vetoedBy?.id, "G3");
    // The checklist still reports what DID run, including the refusal.
    assert.equal(result.verdicts.length, 3);
  });

  it("blocks when a REQUIRED gate is unavailable — absence is not consent", async () => {
    const gates: GateDefinition[] = [
      pass("G1"),
      { id: "G2", run: async () => ({ status: "unavailable" as const }) },
      pass("G3"),
      pass("G4"),
      pass("G5"),
      // G6 is required: geometry that cannot run must not ship a plan.
      { id: "G6", run: async () => ({ status: "unavailable" as const, reasonAr: "لا هندسة" }) },
      pass("G7"),
    ];
    const result = await runGateChain(gates);
    assert.equal(result.allowed, false, "a required gate that could not run must block");
    assert.equal(result.vetoedBy?.id, "G6");
    // G2 is optional — being unavailable did not stop the chain reaching G5.
    assert.equal(result.verdicts.find((v) => v.id === "G2")?.status, "unavailable");
  });

  it("survives an OPTIONAL gate being unavailable", async () => {
    const gates: GateDefinition[] = GATE_IDS.map((id) =>
      id === "G2" || id === "G3"
        ? { id, run: async () => ({ status: "unavailable" as const }) }
        : pass(id),
    );
    const result = await runGateChain(gates);
    assert.equal(result.allowed, true, "liquidity/supply absence costs context, not the plan");
  });

  it("treats a THROWN gate as unavailable, never as a pass", async () => {
    const gates: GateDefinition[] = [
      pass("G1"),
      pass("G2"),
      pass("G3"),
      {
        id: "G4",
        run: async () => {
          throw new Error("structure provider exploded");
        },
      },
      pass("G5"),
      pass("G6"),
      pass("G7"),
    ];
    const result = await runGateChain(gates);
    assert.equal(result.allowed, false);
    assert.equal(result.vetoedBy?.id, "G4");
    assert.match(result.vetoedBy?.reasonAr ?? "", /structure provider exploded/);
  });

  it("sums confidence deltas across gates", async () => {
    const gates: GateDefinition[] = GATE_IDS.map((id) => ({
      id,
      run: async () => ({ status: "pass" as const, confidenceDelta: id === "G4" ? -10 : 0 }),
    }));
    const result = await runGateChain(gates);
    assert.equal(result.confidenceDelta, -10);
  });

  it("names the refusing gate in the operator summary", async () => {
    const gates: GateDefinition[] = [
      { id: "G1", run: async () => ({ status: "veto" as const, reasonAr: "خبر CPI بعد 25 دقيقة" }) },
    ];
    const result = await runGateChain(gates);
    const summary = refusalSummaryAr(result);
    assert.match(summary ?? "", /الأخبار/);
    assert.match(summary ?? "", /CPI/);
    assert.equal(refusalSummaryAr({ ...result, allowed: true }), null);
  });
});

describe("G1 — the news blackout window", () => {
  const T = Date.parse("2026-08-05T12:00:00Z");
  const cpi = { title: "US CPI", time: T, impact: "high" as const, currency: "USD" };
  const win = { before: 30, after: 15 };

  it("blocks inside the window on both sides of the print", () => {
    // 25 minutes before.
    const before = evaluateNewsWindow({ events: [cpi], now: T - 25 * 60_000, window: win });
    assert.equal(before.blocked, true);
    assert.equal(before.minutesUntilClear, 40, "25 min before + 15 after = 40 to clear");

    // 10 minutes after.
    const after = evaluateNewsWindow({ events: [cpi], now: T + 10 * 60_000, window: win });
    assert.equal(after.blocked, true);
  });

  it("does not block outside the window", () => {
    const early = evaluateNewsWindow({ events: [cpi], now: T - 31 * 60_000, window: win });
    assert.equal(early.blocked, false);
    const late = evaluateNewsWindow({ events: [cpi], now: T + 16 * 60_000, window: win });
    assert.equal(late.blocked, false);
  });

  it("only high-impact events block", () => {
    const medium = { ...cpi, impact: "medium" as const };
    const v = evaluateNewsWindow({ events: [medium], now: T, window: win });
    assert.equal(v.blocked, false, "blocking on medium events would silence the platform");
  });

  it("waits for the LAST window when several overlap", () => {
    const second = { ...cpi, title: "FOMC", time: T + 20 * 60_000 };
    const v = evaluateNewsWindow({ events: [cpi, second], now: T, window: win });
    assert.equal(v.blocked, true);
    assert.equal(v.event?.title, "FOMC");
    assert.equal(v.minutesUntilClear, 35);
  });

  it("names the event and the wait in the reason", () => {
    const v = evaluateNewsWindow({ events: [cpi], now: T - 25 * 60_000, window: win });
    const reason = newsBlockReasonAr(v);
    assert.match(reason ?? "", /US CPI/);
    assert.match(reason ?? "", /40/);
  });
});

describe("G7 — live revalidation", () => {
  const plan = {
    direction: "sell" as const,
    effectiveEntry: 4345.6,
    stopLoss: 4360.78,
    targets: [4316.8],
    atr: 4.0,
    minRr: 1.5,
  };

  it("passes while price is still near the entry", () => {
    const v = revalidatePlan({ ...plan, currentPrice: 4345.0 });
    assert.equal(v.status, "ok");
    assert.ok((v.liveRr ?? 0) > 1.5);
  });

  it("refuses a plan whose entry price has run away", () => {
    // A sell entry becomes unreachable when price drops well past it.
    const v = revalidatePlan({ ...plan, currentPrice: 4335.0 });
    assert.equal(v.status, "unreachable");
    assert.match(v.reasonAr ?? "", /تجاوز/);
  });

  it("refuses a plan whose RR has degraded below the minimum", () => {
    // Price close to TP with the same stop: still possible, no longer worth it.
    const v = revalidatePlan({
      ...plan,
      currentPrice: 4345.8,
      minRr: 100,
    });
    assert.equal(v.status, "rr_degraded");
    assert.match(v.reasonAr ?? "", /العائد\/المخاطرة/);
  });

  it("measures RR from the live price, not the written entry", () => {
    const v = revalidatePlan({ ...plan, currentPrice: 4350.0 });
    const fromEntry = (4345.6 - 4316.8) / (4360.78 - 4345.6);
    assert.notEqual(
      (v.liveRr ?? 0).toFixed(2),
      fromEntry.toFixed(2),
      "the operator's real RR is the one from the price they can get now",
    );
  });
});
