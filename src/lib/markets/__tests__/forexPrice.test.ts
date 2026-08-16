/**
 * The quote acceptance rule — small on purpose, load-bearing on weekends.
 *
 * OANDA answers a weekend pricing request with the LAST price it remembers
 * and `tradeable: false`. The flag was parsed and never read, so Friday's
 * close passed as a live quote — and G7's live-price revalidation graded
 * weekend plans against a price that was not a price. `usableQuote` is where
 * that stops.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { usableQuote } from "@/lib/markets/forexPrice";

describe("usableQuote", () => {
  it("accepts a live, finite, ordered book", () => {
    assert.equal(usableQuote({ bid: 4000.1, ask: 4000.4, tradeable: true }), true);
    // No flag at all (older payloads) is not a halt.
    assert.equal(usableQuote({ bid: 4000.1, ask: 4000.4 }), true);
  });

  it("refuses a halted instrument even when the numbers look perfect", () => {
    // The weekend case: numbers are Friday's close, flag says halted.
    assert.equal(usableQuote({ bid: 4000.1, ask: 4000.4, tradeable: false }), false);
  });

  it("refuses an empty or degenerate book", () => {
    assert.equal(usableQuote({ bid: null, ask: 4000.4 }), false);
    assert.equal(usableQuote({ bid: 4000.4, ask: null }), false);
    assert.equal(usableQuote({ bid: 0, ask: 0 }), false);
    assert.equal(usableQuote({ bid: 4000.5, ask: 4000.1 }), false, "crossed book");
    assert.equal(usableQuote({ bid: Number.NaN, ask: 4000.4 }), false);
  });

  it("accepts a zero-spread book — bid equal to ask happens on thin metals", () => {
    assert.equal(usableQuote({ bid: 4000.2, ask: 4000.2 }), true);
  });
});
