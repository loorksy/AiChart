import { execute, insertReturningId, query, queryOne } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { createLogger } from "@/lib/logger";

const log = createLogger("metaapi.lifecycle");

/**
 * V2-B (#96): presence-based deploy lifecycle — the cost model's heart.
 *
 * MetaApi bills per DEPLOYED hour; an undeployed account is free. So the
 * account is deployed only while its owner is actually around: every open
 * app session heartbeats; IDLE_GRACE_MS after the last beat the account is
 * undeployed and the deploy-session row is closed, its hours burned from
 * the owner's credits at METAAPI_HOURLY_USD × the retail multiplier. The
 * next heartbeat redeploys silently. Accounts running live auto-execution
 * are PINNED — never undeployed, whatever the presence says.
 */

export const IDLE_GRACE_MS = 15 * 60 * 1000;

export async function metaapiUxEnabled(): Promise<boolean> {
  const flag = await getPlatformValueAsync("METAAPI_UX_ENABLED");
  return flag === "1" || flag === "true";
}

/**
 * Keep every linked account deployed around the clock.
 *
 * Defaults ON: a broker connection that drops because the operator closed a
 * browser tab is not a connection they can plan a trade around. Set
 * METAAPI_ALWAYS_ON=0 to bring back idle-undeploy and its lower bill.
 */
export async function metaapiAlwaysOn(): Promise<boolean> {
  const flag = (await getPlatformValueAsync("METAAPI_ALWAYS_ON"))?.trim();
  return flag !== "0" && flag !== "false";
}

async function metaapiHourlyUsd(): Promise<number> {
  const raw = Number(await getPlatformValueAsync("METAAPI_HOURLY_USD"));
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.02;
}

async function retailMultiplier(): Promise<number> {
  const raw = Number(await getPlatformValueAsync("BILLING_RETAIL_MULTIPLIER"));
  return Number.isFinite(raw) && raw >= 1 ? raw : 1;
}

/** Pure: billable hours of a session, minute-resolution, never negative. */
export function computeSessionHours(deployedAt: number, undeployedAt: number): number {
  const ms = Math.max(0, undeployedAt - deployedAt);
  return Math.round((ms / 3_600_000) * 60) / 60;
}

/** Pure: the undeploy decision. Pinned accounts never undeploy. */
export function shouldUndeploy(input: {
  lastSeen: number | null;
  now: number;
  pinned: boolean;
  graceMs?: number;
}): boolean {
  if (input.pinned) return false;
  const grace = input.graceMs ?? IDLE_GRACE_MS;
  if (input.lastSeen == null) return true;
  return input.now - input.lastSeen > grace;
}

/**
 * Live auto-execution pins the deployment: the agent needs the broker link
 * to manage positions while the owner sleeps. Mode lives in trading_settings
 * (agent_trade_mode = 'auto').
 */
export async function isLiveExecutionPinned(userId: number): Promise<boolean> {
  const row = await queryOne<{ agent_trade_mode: string | null }>(
    "SELECT agent_trade_mode FROM trading_settings WHERE user_id = ?",
    [userId],
  );
  return row?.agent_trade_mode === "auto";
}

export async function markPresence(userId: number): Promise<{ redeployed: boolean }> {
  const now = Date.now();
  const updated = await execute(
    "UPDATE mt_presence SET last_seen = ? WHERE user_id = ?",
    [now, userId],
  );
  if (!updated.changes) {
    await execute(
      "INSERT INTO mt_presence (user_id, last_seen) VALUES (?, ?)",
      [userId, now],
    );
  }

  // Silent auto-return: an idle-undeployed account comes back on the first beat.
  if (!(await metaapiUxEnabled())) return { redeployed: false };
  const account = await queryOne<{ metaapi_account_id: string | null; state: string }>(
    "SELECT metaapi_account_id, state FROM mt_accounts WHERE user_id = ?",
    [userId],
  );
  if (!account?.metaapi_account_id || account.state !== "undeployed_idle") {
    return { redeployed: false };
  }
  try {
    await deployAccount(userId, account.metaapi_account_id);
    return { redeployed: true };
  } catch (e) {
    log.warn("redeploy.failed", {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { redeployed: false };
  }
}

export async function openDeploySession(
  userId: number,
  accountId: string,
  reason: string,
): Promise<void> {
  const open = await queryOne(
    "SELECT id FROM metaapi_deploy_sessions WHERE user_id = ? AND account_id = ? AND undeployed_at IS NULL",
    [userId, accountId],
  );
  if (open) return; // already metering
  await insertReturningId(
    "INSERT INTO metaapi_deploy_sessions (user_id, account_id, deployed_at, reason) VALUES (?, ?, ?, ?)",
    [userId, accountId, Date.now(), reason],
  );
}

export async function closeDeploySession(
  userId: number,
  accountId: string,
  reason: string,
): Promise<{ hours: number; retailUsd: number } | null> {
  const open = await queryOne<{ id: number; deployed_at: number }>(
    "SELECT id, deployed_at FROM metaapi_deploy_sessions WHERE user_id = ? AND account_id = ? AND undeployed_at IS NULL",
    [userId, accountId],
  );
  if (!open) return null;
  const now = Date.now();
  const hours = computeSessionHours(Number(open.deployed_at), now);
  const retailUsd =
    Math.round(hours * (await metaapiHourlyUsd()) * (await retailMultiplier()) * 10_000) /
    10_000;
  await execute(
    "UPDATE metaapi_deploy_sessions SET undeployed_at = ?, hours = ?, retail_usd = ?, reason = ? WHERE id = ?",
    [now, hours, retailUsd, reason, open.id],
  );
  if (retailUsd > 0) {
    const { burn } = await import("@/lib/billing/creditLedger");
    await burn(userId, retailUsd, `mt5:${open.id}`);
  }
  return { hours, retailUsd };
}

async function sdkAccount(metaapiAccountId: string) {
  const { getMetaApi } = await import("./client");
  const api = await getMetaApi();
  return api.metatraderAccountApi.getAccount(metaapiAccountId);
}

export async function deployAccount(userId: number, metaapiAccountId: string): Promise<void> {
  const account = await sdkAccount(metaapiAccountId);
  await account.deploy();
  await execute("UPDATE mt_accounts SET state = 'deployed' WHERE user_id = ?", [userId]);
  await openDeploySession(userId, metaapiAccountId, "presence");
  log.info("deployed", { userId });
}

export async function undeployAccount(
  userId: number,
  metaapiAccountId: string,
  reason: string,
): Promise<void> {
  const account = await sdkAccount(metaapiAccountId);
  await account.undeploy();
  await execute("UPDATE mt_accounts SET state = 'undeployed_idle' WHERE user_id = ?", [
    userId,
  ]);
  const closed = await closeDeploySession(userId, metaapiAccountId, reason);
  log.info("undeployed", { userId, reason, hours: closed?.hours });
}

/**
 * Bring every linked account back up, and keep it up.
 *
 * Stopping the undeploy is only half of "connected around the clock": an
 * account already parked as undeployed_idle would otherwise stay parked until
 * its owner next opened the app, which is exactly the dependence on presence
 * that always-on removes. The sweep runs every five minutes, so a link that
 * drops for any reason is back within one cycle whether or not anyone is
 * looking.
 */
export async function ensureAlwaysOnDeployed(): Promise<number> {
  const accounts = await query<{ user_id: number; metaapi_account_id: string | null; state: string }>(
    "SELECT user_id, metaapi_account_id, state FROM mt_accounts WHERE metaapi_account_id IS NOT NULL",
  );
  let deployed = 0;
  for (const account of accounts) {
    const id = account.metaapi_account_id;
    if (!id || id === "mt5local" || account.state === "DEPLOYED") continue;
    try {
      await deployAccount(account.user_id, id);
      deployed += 1;
    } catch (e) {
      log.warn("always_on_deploy_failed", {
        userId: account.user_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return deployed;
}

/** How much billable time may accrue in one open session before it is rolled. */
export const METER_ROLL_MS = 60 * 60 * 1000;

/**
 * Bill an always-on account without ever taking it down.
 *
 * A session that never closes never charges, because closeDeploySession is
 * where hours turn into a burn. So once an open session is older than an hour
 * it is closed — billing exactly what it accrued — and a fresh one opens in the
 * same breath. The deployment is untouched throughout; only the meter rolls.
 *
 * Returns the number of meters rolled, so the worker's log reads the same shape
 * as the undeploy count it replaces.
 */
export async function rollOpenDeploySessions(now = Date.now()): Promise<number> {
  const open = await query<{ user_id: number; account_id: string; deployed_at: number }>(
    "SELECT user_id, account_id, deployed_at FROM metaapi_deploy_sessions WHERE undeployed_at IS NULL",
  );
  let rolled = 0;
  for (const session of open) {
    if (now - Number(session.deployed_at) < METER_ROLL_MS) continue;
    try {
      await closeDeploySession(session.user_id, session.account_id, "meter_roll");
      await openDeploySession(session.user_id, session.account_id, "always_on");
      rolled += 1;
    } catch (e) {
      log.warn("meter_roll_failed", {
        userId: session.user_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return rolled;
}

/**
 * The worker's 5-minute sweep: undeploy every idle, unpinned account.
 * Fail-soft per account — one broken account never stalls the sweep.
 */
export async function sweepIdleDeployments(now = Date.now()): Promise<number> {
  if (!(await metaapiUxEnabled())) return 0;
  /*
   * Always-on: leaving the platform must not drop the broker link.
   *
   * The idle sweep was built to cut MetaApi's per-deployed-hour bill, and it
   * did that by undeploying an account 15 minutes after its owner closed the
   * tab. That also means the link a trader expects to be up around the clock
   * — like the terminal it replaces — quietly goes down when they walk away.
   * Connection continuity wins; METAAPI_ALWAYS_ON=0 restores the old
   * cost-saving behaviour if the bill ever argues otherwise.
   *
   * Hours still bill — but only because the sweep rolls the meter. Billing
   * lives in closeDeploySession, which used to run ONLY on undeploy: stopping
   * the undeploy without this would mean no session ever closes and not one
   * hour is ever charged, on an account that is now up 24/7. The whole point
   * of the cost model was that the owner never pays out of pocket.
   */
  if (await metaapiAlwaysOn()) {
    await ensureAlwaysOnDeployed();
    return rollOpenDeploySessions(now);
  }
  const open = await query<{ user_id: number; account_id: string }>(
    "SELECT DISTINCT user_id, account_id FROM metaapi_deploy_sessions WHERE undeployed_at IS NULL",
  );
  let undeployed = 0;
  for (const session of open) {
    try {
      const presence = await queryOne<{ last_seen: number }>(
        "SELECT last_seen FROM mt_presence WHERE user_id = ?",
        [session.user_id],
      );
      const pinned = await isLiveExecutionPinned(session.user_id);
      if (
        shouldUndeploy({
          lastSeen: presence ? Number(presence.last_seen) : null,
          now,
          pinned,
        })
      ) {
        await undeployAccount(session.user_id, session.account_id, "idle");
        undeployed += 1;
      }
    } catch (e) {
      log.warn("sweep.account_failed", {
        userId: session.user_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return undeployed;
}
