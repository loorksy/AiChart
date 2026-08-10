import { execute, insertReturningId, query, queryOne } from "@/lib/db";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { createLogger } from "@/lib/logger";

const log = createLogger("metaapi.lifecycle");

/**
 * V2-B (#96): presence-based deploy lifecycle.
 *
 * Every linked account stays deployed around the clock, unconditionally —
 * there is no idle-undeploy path and nothing in this module can drop the
 * broker connection. The account bills while deployed, at METAAPI_HOURLY_USD
 * × the retail multiplier; rollOpenDeploySessions rolls the meter every hour
 * without ever taking the deployment down. See sweepIdleDeployments.
 */

export async function metaapiUxEnabled(): Promise<boolean> {
  const flag = await getPlatformValueAsync("METAAPI_UX_ENABLED");
  return flag === "1" || flag === "true";
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

/**
 * Bring every linked account back up, and keep it up.
 *
 * There is no undeploy anywhere in this module, so this is the only thing
 * standing between a dropped broker link and the user noticing: the sweep
 * runs every five minutes, so a link that drops for any reason (a MetaApi
 * restart, a transient error) is back within one cycle whether or not
 * anyone is looking.
 */
export async function ensureAlwaysOnDeployed(): Promise<number> {
  const accounts = await query<{ user_id: number; metaapi_account_id: string | null; state: string }>(
    "SELECT user_id, metaapi_account_id, state FROM mt_accounts WHERE metaapi_account_id IS NOT NULL",
  );
  let deployed = 0;
  for (const account of accounts) {
    const id = account.metaapi_account_id;
    /*
     * `deployed`, lowercase — the column's own vocabulary, written by
     * deployAccount. "DEPLOYED" is the SDK account object's state, a different
     * value on a different object that happens to share the word. Comparing
     * against the SDK spelling never matches a row, so this redeployed an
     * already-deployed account on every five-minute sweep, forever.
     */
    if (!id || id === "mt5local") continue;
    if (account.state?.toLowerCase() === "deployed") continue;
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
  const open = await query<{
    user_id: number;
    account_id: string;
    deployed_at: number;
    current_account_id: string | null;
  }>(
    `SELECT s.user_id, s.account_id, s.deployed_at, a.metaapi_account_id AS current_account_id
       FROM metaapi_deploy_sessions s
       LEFT JOIN mt_accounts a ON a.user_id = s.user_id
      WHERE s.undeployed_at IS NULL`,
  );
  let rolled = 0;
  for (const session of open) {
    /*
     * A meter left open on an account the user has since re-linked away from.
     * Relinking creates a NEW MetaApi account and leaves the old session open,
     * so rolling it forward kept dead accounts metering — three open sessions
     * on one user, two of them for accounts that are not deployed and that
     * MetaApi is not charging for either. Close it, charge nothing, and do not
     * reopen: there is no deployment behind it to bill.
     */
    if (session.current_account_id !== session.account_id) {
      try {
        await execute(
          "UPDATE metaapi_deploy_sessions SET undeployed_at = ?, hours = 0, retail_usd = 0, reason = ? WHERE user_id = ? AND account_id = ? AND undeployed_at IS NULL",
          [now, "stale_account", session.user_id, session.account_id],
        );
        log.info("stale_meter_closed", {
          userId: session.user_id,
          accountId: session.account_id,
        });
      } catch (e) {
        log.warn("stale_meter_close_failed", {
          userId: session.user_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      continue;
    }
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
 * The worker's 5-minute sweep: keep every linked account deployed and roll
 * its billing meter. Fail-soft per account — one broken account never
 * stalls the sweep.
 */
export async function sweepIdleDeployments(now = Date.now()): Promise<number> {
  if (!(await metaapiUxEnabled())) return 0;
  /*
   * Always-on, unconditionally: leaving the platform must never drop the
   * broker link. There is no idle-undeploy branch here and no config flag
   * that can bring one back — the link a trader expects to be up around the
   * clock, like the terminal it replaces, cannot quietly go down because
   * they walked away or an admin flipped a setting.
   *
   * Hours still bill — the sweep rolls the meter instead of undeploying.
   * Billing lives in closeDeploySession, called from rollOpenDeploySessions
   * on every roll, so an account up 24/7 is still charged for every hour of
   * it. The cost model's premise (the owner never pays out of pocket) holds
   * without needing to ever take the deployment down.
   */
  await ensureAlwaysOnDeployed();
  return rollOpenDeploySessions(now);
}
