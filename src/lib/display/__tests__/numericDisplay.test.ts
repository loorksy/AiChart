import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatUsd,
  isNumericReady,
  numericFromOptional,
} from "@/lib/display/numericDisplay";
import { balanceChipStateFromApi } from "@/components/shell/BalanceChip";
import { attachMandatoryPresentation } from "@/lib/agent/envelopePresentation";
import { descriptiveEnvelope } from "@/lib/agent/resultEnvelope";

describe("numericDisplay", () => {
  it("treats zero as a ready value", () => {
    assert.equal(isNumericReady(0), true);
    assert.deepEqual(numericFromOptional(0), { status: "ready", value: 0 });
    assert.equal(formatUsd(0), "$0.00");
  });

  it("does not treat null as ready", () => {
    assert.equal(isNumericReady(null), false);
    assert.deepEqual(numericFromOptional(null), { status: "loading" });
  });
});

describe("balanceChipStateFromApi", () => {
  it("renders zero credit as ready", () => {
    assert.deepEqual(balanceChipStateFromApi({ ok: true, balance: 0 }), {
      status: "ready",
      value: 0,
    });
  });

  it("errors when the balance is missing", () => {
    assert.deepEqual(balanceChipStateFromApi({ ok: true }), {
      status: "error",
    });
  });
});

describe("attachMandatoryPresentation", () => {
  it("cites two numeric levels and NEVER names the data vendor", () => {
    // The "مصدر البيانات: …" line used to be prepended here. Operator
    // instruction: the data source is internal provenance — no user-facing
    // surface may carry it, so presentation only guarantees the levels.
    const { summary, envelope } = attachMandatoryPresentation({
      summary: "Short analysis.",
      envelope: descriptiveEnvelope(),
      levels: [4090.5, 4110.25],
      locale: "en",
    });
    assert.doesNotMatch(summary, /OANDA|مصدر البيانات|data source/i);
    assert.match(summary, /4090\.50/);
    assert.match(summary, /4110\.25/);
    assert.equal(envelope.market_data_source, undefined);
    assert.deepEqual(envelope.key_price_levels, [4090.5, 4110.25]);
  });

  it("leaves a summary that already cites numbers untouched", () => {
    const { summary, envelope } = attachMandatoryPresentation({
      summary: "Support at 4090.50, resistance at 4110.25.",
      envelope: descriptiveEnvelope(),
      levels: [4090.5, 4110.25],
      locale: "en",
    });
    assert.equal(summary, "Support at 4090.50, resistance at 4110.25.");
    assert.equal(envelope.market_data_source, undefined);
  });
});
