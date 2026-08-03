/**
 * The three ways an account can be connected — OANDA data, the EA bridge, and
 * the server-side backends (MetaApi / self-hosted MT5) — against a real
 * database.
 *
 * Two invariants are pinned here, both of which were violated by code that
 * asked the EA connection about accounts that were never connected through it:
 *
 *  1. Broker market data is served from the EA ONLY when an EA is actually
 *     linked. Any other connection reads platform data instead of queueing
 *     commands at a terminal that will never answer them.
 *  2. The broker's own account type — demo or real — is read from whichever
 *     backend the account is connected through. A real-money MetaApi account
 *     that resolves to "unknown" is a live-execution protection that silently
 *     does not engage.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-backend-parity-"));
process.env.DB_PATH = join(dir, "parity.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "backend-parity-test-secret";
delete process.env.DATABASE_URL;
delete process.env.FOREX_BACKEND;
delete process.env.MT5_BRIDGE_URL;
// A token is what makes the platform-side backend selectable at all; without
// one the "metaapi" preference legitimately falls back to the EA.
process.env.METAAPI_TOKEN = "test-token";

let eaUser = 0;
let cloudUser = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  eaUser = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["ea-user@example.com", "x", "user", "active"],
  );
  cloudUser = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["cloud-user@example.com", "x", "user", "active"],
  );
  const store = await import("@/lib/store");
  await store.ensureUserDefaults(eaUser);
  await store.ensureUserDefaults(cloudUser);
  // The cloud user picked the platform-side backend; the EA user picked the EA.
  await store.updateSettings(eaUser, { forex_backend: "ea" });
  await store.updateSettings(cloudUser, { forex_backend: "metaapi" });
});

describe("market data source", () => {
  /*
   * This pair used to be one case asserting that an explicit `ea` request came
   * back `oanda_data_only`. That was the deployment flag short-circuiting
   * before anything looked at what the account had connected — and since
   * FOREX_DATA_SOURCE falls back to "oanda", it did so on every deployment,
   * which is why the three-pipe picker could only ever offer one pipe.
   *
   * The source it lands on is unchanged. What changed is that the flag now
   * governs the default rather than overruling a choice, and the fallback
   * reason names the real cause.
   */
  it("keeps platform data as the default while the deployment says OANDA", async () => {
    delete process.env.FOREX_DATA_SOURCE;
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");
    const decision = await resolveMarketDataSource(eaUser, null);
    assert.equal(decision.source, "oanda");
    assert.equal(decision.reason, "oanda_data_only");
  });

  it("falls back for the honest reason when the pipe is not connected", async () => {
    delete process.env.FOREX_DATA_SOURCE;
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");
    const decision = await resolveMarketDataSource(eaUser, "ea");
    assert.equal(decision.source, "oanda");
    // Not "oanda_data_only": this account simply has no EA linked, and telling
    // it otherwise is what put "link an account" under an already-linked one.
    assert.equal(decision.reason, "ea_not_connected");
    assert.equal(decision.available.ea, false);
  });

  it("never asks a terminal that is not there", async () => {
    process.env.FOREX_DATA_SOURCE = "ea";
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");

    // A request that did not ask for broker data is platform data, full stop.
    assert.equal((await resolveMarketDataSource(eaUser, null)).source, "oanda");
    assert.equal((await resolveMarketDataSource(eaUser, "oanda")).source, "oanda");

    // EA asked for but nothing linked yet: platform data, and it says why.
    const unlinked = await resolveMarketDataSource(eaUser, "ea");
    assert.equal(unlinked.source, "oanda");
    assert.equal(unlinked.reason, "ea_not_connected");
    assert.equal(unlinked.available.ea, false);

    // A cloud account has no EA to answer either — same honest fallback.
    const cloud = await resolveMarketDataSource(cloudUser, "ea");
    assert.equal(cloud.source, "oanda");
    assert.equal(cloud.reason, "ea_not_connected");

    // Guests get platform data rather than a 401 they cannot act on.
    assert.equal((await resolveMarketDataSource(null, "ea")).source, "oanda");
  });

  it("serves broker data once an EA is genuinely linked", async () => {
    process.env.FOREX_DATA_SOURCE = "ea";
    const db = await import("@/lib/db");
    await db.execute(
      `INSERT INTO ea_connections (user_id, token_hash, status, last_heartbeat_at)
       VALUES (?, ?, 'active', ?)`,
      [eaUser, "hash-ea-user", new Date().toISOString()],
    );
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");
    const linked = await resolveMarketDataSource(eaUser, "ea");
    assert.equal(linked.source, "ea");
    assert.equal(linked.reason, "user_choice");
    assert.equal(linked.available.ea, true);
  });

  it("defaults to the cloud account once it is linked, and honours a pin", async () => {
    process.env.FOREX_DATA_SOURCE = "ea";
    const store = await import("@/lib/store");
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");

    // Nothing pinned: an EA-only account reads its own terminal…
    await store.updateSettings(eaUser, { market_data_source: "auto" });
    const eaAuto = await resolveMarketDataSource(eaUser);
    assert.equal(eaAuto.source, "ea");
    assert.equal(eaAuto.reason, "auto_ea");

    // …and a linked cloud account wins over everything, per the product rule:
    // linking a broker is a statement about which market you want to see.
    await store.saveMtAccount(cloudUser, {
      platform: "mt5",
      server: "Broker-Demo",
      login: "9001",
      password: "secret",
      metaapiAccountId: "acct-cloud",
      state: "DEPLOYED",
      connectionStatus: "CONNECTED",
    });
    await store.updateSettings(cloudUser, { market_data_source: "auto" });
    const cloudAuto = await resolveMarketDataSource(cloudUser);
    assert.equal(cloudAuto.source, "metaapi");
    assert.equal(cloudAuto.reason, "auto_metaapi");
    assert.equal(cloudAuto.available.metaapi, true);

    // A pin is obeyed — the free platform feed stays one tap away.
    await store.updateSettings(cloudUser, { market_data_source: "oanda" });
    const pinned = await resolveMarketDataSource(cloudUser);
    assert.equal(pinned.source, "oanda");
    assert.equal(pinned.preference, "oanda");

    // A pin on a pipe that is not connected never strands the user.
    await store.updateSettings(eaUser, { market_data_source: "metaapi" });
    const impossible = await resolveMarketDataSource(eaUser);
    assert.equal(impossible.source, "oanda");
    assert.equal(impossible.reason, "metaapi_not_connected");
    await store.updateSettings(eaUser, { market_data_source: "auto" });
  });
});

describe("execution environment", () => {
  it("normalizes the broker's account type from every dialect", async () => {
    const { normalizeMtTradeMode } = await import("@/lib/executionEnv");
    // The EA sends the bare word; MetaApi sends MT5's enum. Same account.
    assert.equal(normalizeMtTradeMode("real"), "live");
    assert.equal(normalizeMtTradeMode("ACCOUNT_TRADE_MODE_REAL"), "live");
    assert.equal(normalizeMtTradeMode("demo"), "demo");
    assert.equal(normalizeMtTradeMode("ACCOUNT_TRADE_MODE_DEMO"), "demo");
    assert.equal(normalizeMtTradeMode("ACCOUNT_TRADE_MODE_CONTEST"), "contest");
    assert.equal(normalizeMtTradeMode(null), null);
    assert.equal(normalizeMtTradeMode("something-else"), null);
  });

  it("reads a cloud account's type from the cloud account, not from the EA", async () => {
    const store = await import("@/lib/store");
    const { getExecutionEnvSnapshot } = await import("@/lib/executionEnv");
    const { isRealMoneyExecution } = await import("@/lib/executionKillSwitch");

    await store.saveMtAccount(cloudUser, {
      platform: "mt5",
      server: "Broker-Real",
      login: "12345",
      password: "secret",
      metaapiAccountId: "acct-abc",
      state: "DEPLOYED",
      connectionStatus: "CONNECTED",
      accountTradeMode: "ACCOUNT_TRADE_MODE_REAL",
    });

    const snapshot = await getExecutionEnvSnapshot(cloudUser);
    assert.equal(snapshot.forex.connected, true);
    assert.equal(snapshot.forex.online, true);
    assert.equal(snapshot.forex.actual, "live");
    assert.equal(snapshot.forex.resolved, "live");
    // The whole point: this is what makes the live dual-enable gate engage.
    assert.equal(isRealMoneyExecution(snapshot.forex.resolved), true);
  });

  it("keeps a demo cloud account demo, so the demo rollout stage can run", async () => {
    const store = await import("@/lib/store");
    const { getResolvedExecutionEnv } = await import("@/lib/executionEnv");

    await store.updateMtAccountStatus(cloudUser, {
      accountTradeMode: "ACCOUNT_TRADE_MODE_DEMO",
    });
    assert.equal(await getResolvedExecutionEnv(cloudUser, "forex"), "demo");

    // A poll that could not read the type must not erase the known one.
    await store.updateMtAccountStatus(cloudUser, { accountTradeMode: null });
    assert.equal(await getResolvedExecutionEnv(cloudUser, "forex"), "demo");
  });

  it("accepts every connected account and only labels which it is", async () => {
    const store = await import("@/lib/store");
    const { getExecutionEnvSnapshot } = await import("@/lib/executionEnv");
    const { isRealMoneyExecution } = await import("@/lib/executionKillSwitch");
    const { checkExecutionHalt } = await import("@/lib/executionKillSwitch");

    // A trader's first month is usually a demo account. It is a first-class
    // connection, not a lesser one: nothing may refuse it for being demo.
    await store.updateMtAccountStatus(cloudUser, {
      accountTradeMode: "ACCOUNT_TRADE_MODE_DEMO",
    });
    const demo = await getExecutionEnvSnapshot(cloudUser);
    assert.equal(demo.forex.connected, true);
    assert.equal(demo.forex.resolved, "demo");
    assert.equal(isRealMoneyExecution(demo.forex.resolved), false);
    // No kill switch, no live flags — a demo account sails through the halt
    // check, which is the gate that decides whether an order may be sent.
    assert.equal(
      checkExecutionHalt({
        killSwitchFlag: null,
        isLive: isRealMoneyExecution(demo.forex.resolved),
      }).halted,
      false,
    );

    // The same account switched to real money is accepted too — it is simply
    // labelled as real, and real money is what asks for the second enable.
    await store.updateMtAccountStatus(cloudUser, {
      accountTradeMode: "ACCOUNT_TRADE_MODE_REAL",
    });
    const live = await getExecutionEnvSnapshot(cloudUser);
    assert.equal(live.forex.connected, true);
    assert.equal(live.forex.resolved, "live");
    assert.equal(
      checkExecutionHalt({
        killSwitchFlag: null,
        isLive: true,
        liveEnvEnabled: true,
        liveRuntimeEnabled: true,
      }).halted,
      false,
    );
  });

  it("leaves the EA path reading the EA connection", async () => {
    const db = await import("@/lib/db");
    await db.execute(
      "UPDATE ea_connections SET account_trade_mode = ? WHERE user_id = ?",
      ["real", eaUser],
    );
    const { getExecutionEnvSnapshot } = await import("@/lib/executionEnv");
    const snapshot = await getExecutionEnvSnapshot(eaUser);
    assert.equal(snapshot.forex.actual, "live");
    assert.equal(snapshot.forex.resolved, "live");
  });
});
