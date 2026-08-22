import { query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { logAudit } from "@/lib/store";
import { metaapiToken } from "./token";
import { undeployAccount } from "./metaapiClient";
import { updateBrokerLinkStatus } from "./store";

const log = createLogger("brokerLink.expirySweep");

/**
 * Subscription-expiry disconnect (billing v3).
 *
 * A lapsed subscription DISCONNECTS the MT5 link automatically: the MetaAPI
 * account is undeployed — the API connection stops, and NOTHING else
 * happens. No position is closed, no order is touched; whatever the user
 * holds at the broker is theirs and stays exactly as it is. The link row is
 * marked UNDEPLOYED, so the execution layer's own DEPLOYED requirement
 * refuses any further order without a single change to that layer.
 *
 * Resubscribing and relinking is a NEW link event with its own one-time
 * charge (linkFlow.ts).
 */
export interface ExpirySweepDeps {
  token?: string | null;
  undeploy?: typeof undeployAccount;
  markState?: (userId: number, state: string) => Promise<void>;
  notify?: (userId: number) => Promise<void>;
  now?: number;
}

export interface ExpirySweepResult {
  scanned: number;
  disconnected: number[];
  failures: number[];
}

interface ExpiredLinkRow {
  user_id: number;
  metaapi_account_id: string;
  state: string;
}

/** Links whose owner's subscription has lapsed and that are still deployed. */
async function findExpiredDeployedLinks(now: number): Promise<ExpiredLinkRow[]> {
  return query<ExpiredLinkRow>(
    `SELECT b.user_id, b.metaapi_account_id, b.state
       FROM broker_links b
       JOIN user_entitlements e ON e.user_id = b.user_id
       JOIN users u ON u.id = b.user_id
      WHERE u.role != 'admin'
        AND b.state NOT IN ('UNDEPLOYED', 'UNDEPLOYING', 'DELETING')
        AND e.plan_status IN ('active', 'expired')
        AND e.subscription_expires_at IS NOT NULL
        AND e.subscription_expires_at <= ?
      ORDER BY b.user_id`,
    [new Date(now).toISOString()],
  );
}

export async function sweepExpiredBrokerLinks(
  deps: ExpirySweepDeps = {},
): Promise<ExpirySweepResult> {
  const now = deps.now ?? Date.now();
  const token = deps.token !== undefined ? deps.token : await metaapiToken();
  const result: ExpirySweepResult = { scanned: 0, disconnected: [], failures: [] };
  if (!token) return result;

  const rows = await findExpiredDeployedLinks(now);
  result.scanned = rows.length;
  const undeploy = deps.undeploy ?? undeployAccount;
  const markState =
    deps.markState ??
    (async (userId: number, state: string) => updateBrokerLinkStatus(userId, { state }));

  for (const row of rows) {
    try {
      // Connection off — positions and orders untouched, by definition of
      // undeploy (see metaapiClient.undeployAccount).
      await undeploy({ token, accountId: row.metaapi_account_id });
      await markState(row.user_id, "UNDEPLOYED");
      await logAudit(
        row.user_id,
        "broker_link_expired_disconnect",
        `account=${row.metaapi_account_id}`,
      ).catch(() => {});
      await deps.notify?.(row.user_id).catch(() => {});
      result.disconnected.push(row.user_id);
    } catch (error) {
      // Best-effort per user: one broken undeploy must not strand the rest.
      log.warn("expiry disconnect failed", {
        userId: row.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failures.push(row.user_id);
    }
  }
  return result;
}
