import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getMacroRegime,
  clearMacroRegimeCache,
} from "@/lib/agent/macro/fredProvider";
import {
  getCotPositioning,
  clearCotCache,
} from "@/lib/agent/macro/cotProvider";
import { clearPlatformConfigCache } from "@/lib/platformConfig";
import { buildEvidenceDimensions } from "@/lib/agent/evidenceDimensions";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  clearMacroRegimeCache();
  clearCotCache();
  delete process.env.FRED_API_KEY;
  delete process.env.COT_EVIDENCE_V1;
  clearPlatformConfigCache();
});

/** Monthly CPI observations, newest first, ~2%/yr compounding. */
function cpiObservations(count: number): { date: string; value: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-${String(12 - (i % 12)).padStart(2, "0")}-01`,
    value: String(300 * Math.pow(1.02, -i / 12)),
  }));
}

function fredResponse(seriesId: string): unknown {
  if (seriesId === "DFF") {
    // Newest 4.50, oldest (3 months back) 4.00 → rising.
    return {
      observations: Array.from({ length: 95 }, (_, i) => ({
        date: `2026-08-${String(Math.max(1, 28 - i)).padStart(2, "0")}`,
        value: String(4.5 - (i / 94) * 0.5),
      })),
    };
  }
  if (seriesId === "CPIAUCSL") return { observations: cpiObservations(14) };
  if (seriesId === "DGS2")
    return { observations: [{ date: "2026-08-05", value: "4.1" }] };
  if (seriesId === "DGS10")
    return { observations: [{ date: "2026-08-05", value: "3.8" }] };
  if (seriesId === "UNRATE")
    return { observations: [{ date: "2026-07-01", value: "4.2" }, { date: "2026-06-01", value: "4.1" }] };
  return { observations: [] };
}

describe("FRED macro regime", () => {
  it("no key → null block, never a guessed regime", async () => {
    delete process.env.FRED_API_KEY;
    assert.equal(await getMacroRegime(), null);
  });

  it("builds policy trend, CPI YoY, and curve spread from real observations", async () => {
    process.env.FRED_API_KEY = "k";
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const id = /series_id=([A-Z0-9]+)/.exec(String(url))?.[1] ?? "";
      return new Response(JSON.stringify(fredResponse(id)), { status: 200 });
    }) as typeof fetch;

    const block = (await getMacroRegime())!;
    assert.ok(block, "block should build");
    assert.equal(block.policyRatePct, 4.5);
    assert.equal(block.policyTrend, "rising");
    assert.ok(
      block.inflationYoYPct != null && Math.abs(block.inflationYoYPct - 2) < 0.2,
      `CPI YoY ${block.inflationYoYPct} should be ~2%`,
    );
    // 3.8 − 4.1 → inverted curve.
    assert.equal(block.curveSpreadPct, -0.3);
    assert.equal(block.unemploymentPct, 4.2);
    assert.equal(block.source, "fred");
  });

  it("an upstream failure returns null — the bundle simply has no macro entry", async () => {
    process.env.FRED_API_KEY = "k";
    globalThis.fetch = (async () =>
      new Response("down", { status: 500 })) as typeof fetch;
    assert.equal(await getMacroRegime(), null);
  });

  it("missing datapoints ('.') are dropped, not read as zero", async () => {
    process.env.FRED_API_KEY = "k";
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const id = /series_id=([A-Z0-9]+)/.exec(String(url))?.[1] ?? "";
      if (id === "DGS10") {
        return new Response(
          JSON.stringify({
            observations: [
              { date: "2026-08-06", value: "." },
              { date: "2026-08-05", value: "3.9" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(fredResponse(id)), { status: 200 });
    }) as typeof fetch;
    const block = (await getMacroRegime())!;
    assert.equal(block.curveSpreadPct, Math.round((3.9 - 4.1) * 100) / 100);
  });
});

function cotRow(date: string, long: number, short: number) {
  return {
    market_and_exchange_names: "GOLD - COMMODITY EXCHANGE INC.",
    report_date_as_yyyy_mm_dd: date,
    noncomm_positions_long_all: String(long),
    noncomm_positions_short_all: String(short),
  };
}

describe("COT positioning", () => {
  it("computes net, weekly change, and flags a 3y extreme as a crowding warning", async () => {
    // 30 weekly reports: net climbs from 10k to a record 200k (extreme long).
    const rows = Array.from({ length: 30 }, (_, i) =>
      cotRow(
        `2026-${String(Math.max(1, 8 - Math.floor(i / 4))).padStart(2, "0")}-0${(i % 4) + 1}`,
        200_000 - i * 6_500,
        10_000,
      ),
    );
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(rows), { status: 200 })) as typeof fetch;

    const positioning = (await getCotPositioning(["XAU", "USD"]))!;
    const gold = positioning.find((p) => p.currency === "XAU")!;
    assert.equal(gold.netNonCommercial, 190_000);
    assert.equal(gold.weeklyChange, 6_500);
    assert.equal(gold.extremity, "extreme_long");
    assert.ok(gold.rangePosition != null && gold.rangePosition >= 0.9);
  });

  it("irrelevant currencies return null, and the flag turns the source off", async () => {
    assert.equal(await getCotPositioning(["SEK"]), null);
    process.env.COT_EVIDENCE_V1 = "false";
    assert.equal(await getCotPositioning(["EUR", "USD"]), null);
  });

  it("upstream failure yields null — no positioning entry, never an empty claim", async () => {
    globalThis.fetch = (async () =>
      new Response("down", { status: 503 })) as typeof fetch;
    assert.equal(await getCotPositioning(["EUR"]), null);
  });
});

describe("evidence card dimensions for the new blocks", () => {
  const base = {
    planType: "immediate" as const,
    executionState: "valid_now",
    signalStrength: 0.8,
    dataSufficient: true,
  };

  it("always present, with explicit unavailable branches", () => {
    const { dimensions } = buildEvidenceDimensions(base);
    const macro = dimensions.find((d) => d.key === "macro_regime")!;
    const cot = dimensions.find((d) => d.key === "cot_positioning")!;
    assert.equal(macro.grade, "unavailable");
    assert.equal(cot.grade, "unavailable");
    assert.match(macro.detail, /غير متاحة/);
  });

  it("an extreme COT reading grades WEAK — crowding is a warning, not support", () => {
    const { dimensions } = buildEvidenceDimensions({
      ...base,
      macroRegime: {
        policyRatePct: 4.5,
        policyTrend: "rising",
        inflationYoYPct: 2.1,
        curveSpreadPct: -0.3,
      },
      cotPositioning: [{ currency: "XAU", extremity: "extreme_long" }],
    });
    const macro = dimensions.find((d) => d.key === "macro_regime")!;
    const cot = dimensions.find((d) => d.key === "cot_positioning")!;
    assert.equal(macro.grade, "moderate");
    assert.match(macro.detail, /4\.5%/);
    assert.equal(cot.grade, "weak");
    assert.match(cot.detail, /شراء مكتظ/);
  });
});
