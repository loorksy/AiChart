/**
 * A rejected decision must say what the model SENT, not only what was missing.
 *
 * A Zod issue names the absent key and can never name the key used in its
 * place, so "proposedLevels.preferredEntry expected number, received undefined"
 * is true, unactionable, and identical for two different faults: a model that
 * omitted the entry price, and a model that supplied it under another name.
 * That message appeared three times live on 2026-08-24 with no way to tell
 * which — the reply is never stored, so the evidence died with the run.
 *
 * The shape also travels back to the model on the corrective retry, where the
 * bare complaint reads as a demand for a field it believes it already sent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { classifySynthesizerError } from "@/lib/agent/agents/finalDecisionSynthesizer";

const Levels = z.object({
  preferredEntry: z.number().positive(),
  stopLoss: z.number().positive(),
  targets: z.array(z.number().positive()).min(1),
});
const Schema = z.object({ proposedLevels: Levels });

function reject(value: unknown): z.ZodError {
  try {
    Schema.parse(value);
  } catch (e) {
    return e as z.ZodError;
  }
  throw new Error("expected the parse to fail");
}

describe("a schema mismatch reports the shape it rejected", () => {
  it("names the sibling keys the model used instead", () => {
    const raw = {
      proposedLevels: { entry: 4595.17, stop: 4577.2, targets: [4620.5] },
    };
    const { kind, detail } = classifySynthesizerError(reject(raw), raw);
    assert.equal(kind, "schema_mismatch");
    assert.match(detail, /preferredEntry/, "still names the contract's key");
    assert.match(detail, /entry:number/, "and what arrived in its place");
    assert.match(detail, /stop:number/);
    assert.match(detail, /targets:array/);
  });

  it("prints types, never values — no price reaches a log line", () => {
    const raw = {
      proposedLevels: { entry: 4595.17, stop: 4577.2, targets: [4620.5] },
    };
    const { detail } = classifySynthesizerError(reject(raw), raw);
    assert.doesNotMatch(detail, /4595|4577|4620/, "a value must never be printed");
  });

  it("distinguishes a genuinely empty object from a renamed one", () => {
    const raw = { proposedLevels: { targets: [4620.5] } };
    const { detail } = classifySynthesizerError(reject(raw), raw);
    assert.match(detail, /targets:array/);
    assert.doesNotMatch(detail, /entry:/, "nothing was renamed here — say so by omission");
  });

  it("falls back to the bare complaint when the reply is not available", () => {
    const raw = { proposedLevels: { entry: 1 } };
    const { detail } = classifySynthesizerError(reject(raw));
    assert.match(detail, /preferredEntry/);
    assert.doesNotMatch(detail, /المُرسَل/, "no shape is claimed when none was passed");
  });

  it("survives a reply whose failing path holds a non-object", () => {
    // The model can answer with a string, a number, or null where an object
    // belongs. Reporting the shape must never be the thing that throws.
    for (const value of [null, 42, "buy", [1, 2, 3]]) {
      const raw = { proposedLevels: value };
      const { kind } = classifySynthesizerError(reject(raw), raw);
      assert.equal(kind, "schema_mismatch", `survived ${JSON.stringify(value)}`);
    }
  });
});
