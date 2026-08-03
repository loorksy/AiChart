/**
 * The two ways an account can be connected — OANDA platform data, and the
 * server-side backends (MetaApi / self-hosted MT5) — against a real
 * database.
 *
 * Two invariants are pinned here:
 *
 *  1. Broker market data is served from the cloud account ONLY when one is
 *     actually linked. An unlinked account reads platform data instead.
 *  2. The broker's own account type — demo or real — is read from the
 *     account link itself. A real-money MetaApi account that resolves to
 *     "unknown" is a live-execution protection that silently does not
 *     engage.
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
// A token is what makes the platform-side backend selectable at all.
process.env.METAAPI_TOKEN = "test-token";

let unlinkedUser = 0;
let cloudUser = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  unlinkedUser = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["unlinked-user@example.com", "x", "user", "active"],
  );
  cloudUser = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["cloud-user@example.com", "x", "user", "active"],
  );
  const store = await import("@/lib/store");
  await store.ensureUserDefaults(unlinkedUser);
  await store.ensureUserDefaults(cloudUser);
  // The cloud user picked the platform-side backend; the other has no account linked.
  await store.updateSettings(cloudUser, { forex_backend: "metaapi" });
});

describe("market data source", () => {
  it("keeps platform data as the default while the deployment says OANDA", async () => {
    delete process.env.FOREX_DATA_SOURCE;
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");
    const decision = await resolveMarketDataSource(unlinkedUser, null);
    assert.equal(decision.source, "oanda");
    assert.equal(decision.reason, "oanda_data_only");
  });

  it("falls back for the honest reason when the cloud pipe is not connected", async () => {
    delete process.env.FOREX_DATA_SOURCE;
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");
    const decision = await resolveMarketDataSource(unlinkedUser, "metaapi");
    assert.equal(decision.source, "oanda");
    assert.equal(decision.reason, "metaapi_not_connected");
    assert.equal(decision.available.metaapi, false);
  });

  it("never claims a cloud pipe that is not there", async () => {
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");

    // A request that did not ask for broker data is platform data, full stop.
    assert.equal((await resolveMarketDataSource(unlinkedUser, null)).source, "oanda");
    assert.equal((await resolveMarketDataSource(unlinkedUser, "oanda")).source, "oanda");

    // metaapi asked for but nothing linked yet: platform data, and it says why.
    const unlinked = await resolveMarketDataSource(unlinkedUser, "metaapi");
    assert.equal(unlinked.source, "oanda");
    assert.equal(unlinked.reason, "metaapi_not_connected");
    assert.equal(unlinked.available.metaapi, false);

    // Guests get platform data rather than a 401 they cannot act on.
    assert.equal((await resolveMarketDataSource(null, "metaapi")).source, "oanda");
  });

  it("defaults to the cloud account once it is linked, and honours a pin", async () => {
    // The deployment default must allow the cloud pipe for this scenario —
    // "oanda" (the platform's own default) would short-circuit every case
    // below to platform data regardless of what is linked or pinned.
    process.env.FOREX_DATA_SOURCE = "metaapi";
    const store = await import("@/lib/store");
    const { resolveMarketDataSource } = await import("@/lib/markets/marketDataSource");

    // Nothing linked yet: platform data even with no pin.
    await store.updateSettings(unlinkedUser, { market_data_source: "auto" });
    const noAccount = await resolveMarketDataSource(unlinkedUser);
    assert.equal(noAccount.source, "oanda");
    assert.equal(noAccount.reason, "auto_oanda");

    // A linked cloud account wins over the platform feed, per the product
    // rule: linking a broker is a statement about which market you want to see.
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
    await store.updateSettings(unlinkedUser, { market_data_source: "metaapi" });
    const impossible = await resolveMarketDataSource(unlinkedUser);
    assert.equal(impossible.source, "oanda");
    assert.equal(impossible.reason, "metaapi_not_connected");
    await store.updateSettings(unlinkedUser, { market_data_source: "auto" });
  });
});

describe("execution environment", () => {
  it("normalizes the broker's account type from every dialect", async () => {
    const { normalizeMtTradeMode } = await import("@/lib/executionEnv");
    // MetaApi sends MT5's enum; a bridge may send the bare word. Same account.
    assert.equal(normalizeMtTradeMode("real"), "live");
    assert.equal(normalizeMtTradeMode("ACCOUNT_TRADE_MODE_REAL"), "live");
    assert.equal(normalizeMtTradeMode("demo"), "demo");
    assert.equal(normalizeMtTradeMode("ACCOUNT_TRADE_MODE_DEMO"), "demo");
    assert.equal(normalizeMtTradeMode("ACCOUNT_TRADE_MODE_CONTEST"), "contest");
    assert.equal(normalizeMtTradeMode(null), null);
    assert.equal(normalizeMtTradeMode("something-else"), null);
  });

  it("reads a cloud account's type from the account link", async () => {
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

  it("an unlinked account reads as not connected, never a guessed type", async () => {
    const { getExecutionEnvSnapshot } = await import("@/lib/executionEnv");
    const snapshot = await getExecutionEnvSnapshot(unlinkedUser);
    assert.equal(snapshot.forex.connected, false);
    assert.equal(snapshot.forex.actual, null);
    assert.equal(snapshot.forex.resolved, null);
  });
});
