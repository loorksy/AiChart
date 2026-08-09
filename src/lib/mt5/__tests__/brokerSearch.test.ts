import assert from "node:assert/strict";
import test from "node:test";
import {
  brokerLogoSlug,
  brokerMonogram,
  groupServersByBroker,
  parseKnownServers,
} from "@/lib/mt5/brokerSearch";

/**
 * Captured verbatim from MetaApi's
 * GET /known-mt-servers/5/search?query=exness on 2026-08-07. The first
 * implementation of this route called an endpoint that does not exist and
 * expected a flat array, so search 404'd on every query and the wizard
 * silently fell back to manual entry. Pinning the real shape here is what
 * stops that from being re-invented.
 */
const REAL_RESPONSE = {
  "Exness B.V.": ["ExnessBV-MT5Real11", "ExnessBV-MT5Real12"],
  "Exness (UK) Ltd": ["ExnessUK-LP_Real1", "ExnessUK-Demo"],
};

test("parses MetaApi's broker-to-servers map into wizard rows", () => {
  const groups = parseKnownServers(REAL_RESPONSE);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "Exness B.V.");
  assert.deepEqual(groups[0].servers, ["ExnessBV-MT5Real11", "ExnessBV-MT5Real12"]);
  assert.equal(groups[1].name, "Exness (UK) Ltd");
});

test("an unmatched query is an empty result, never an invented broker", () => {
  assert.deepEqual(parseKnownServers({}), []);
});

test("hostile or unexpected payloads degrade to no results, not a throw", () => {
  assert.deepEqual(parseKnownServers(null), []);
  assert.deepEqual(parseKnownServers(["Exness-MT5Real8"]), []);
  assert.deepEqual(parseKnownServers("nope"), []);
  assert.deepEqual(parseKnownServers({ Broker: "not-an-array" }), []);
  assert.deepEqual(parseKnownServers({ Broker: [] }), []);
  assert.deepEqual(parseKnownServers({ Broker: [1, null, "  "] }), []);
});

test("the route calls the endpoint that actually exists", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const route = readFileSync(
    resolve(process.cwd(), "src/app/api/mt5/brokers/route.ts"),
    "utf8",
  );
  assert.match(route, /known-mt-servers\/5\/search\?query=/);
  assert.doesNotMatch(route, /users\/current\/servers\/mt5/);
});

test("groups server names under one broker row per prefix", () => {
  const groups = groupServersByBroker([
    "Exness-MT5Real8",
    "Exness-MT5Real9",
    "Exness-MT5Trial7",
    "ICMarketsSC-Demo",
    "ICMarketsSC-MT5",
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "Exness");
  assert.deepEqual(groups[0].servers, [
    "Exness-MT5Real8",
    "Exness-MT5Real9",
    "Exness-MT5Trial7",
  ]);
  assert.equal(groups[1].name, "ICMarketsSC");
  assert.equal(groups[1].servers.length, 2);
});

test("a dashless server is its own broker and duplicates collapse", () => {
  const groups = groupServersByBroker(["FusionMarkets", "FusionMarkets", "Fusion-Demo"]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "FusionMarkets");
  assert.deepEqual(groups[0].servers, ["FusionMarkets"]);
  assert.deepEqual(groups[1].servers, ["Fusion-Demo"]);
});

test("grouping is case-insensitive on the prefix but keeps the first spelling", () => {
  const groups = groupServersByBroker(["EXNESS-MT5Real8", "Exness-MT5Real9"]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "EXNESS");
  assert.equal(groups[0].servers.length, 2);
});

test("monogram is two letters, never empty, and slug is url-safe", () => {
  assert.equal(brokerMonogram("Exness"), "EX");
  assert.equal(brokerMonogram("IC Markets"), "IC");
  assert.equal(brokerMonogram(""), "MT");
  assert.equal(brokerLogoSlug("ICMarketsSC"), "icmarketssc");
  assert.equal(brokerLogoSlug("Admiral Markets (UK)"), "admiral-markets-uk");
});

test("the wizard consumes the grouped shape, not the flat list", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const wizard = readFileSync(
    resolve(process.cwd(), "src/components/mt5/Mt5ConnectWizard.tsx"),
    "utf8",
  );
  assert.match(wizard, /brokers\?q=/);
  assert.match(wizard, /BrokerGroup/);
  assert.match(wizard, /useLocale/);
  // Transparency copy and manual fallback must survive redesigns.
  assert.match(wizard, /mt5link\.login_note/);
  assert.match(wizard, /mt5link\.manual_toggle/);
  // Unlink is a destructive act — it must sit behind a confirm.
  assert.match(wizard, /mt5link\.unlink_confirm/);
});
