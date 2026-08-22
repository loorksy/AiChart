import { transaction } from "@/lib/db";
import { debitCredits } from "@/lib/billing/credits";
import { getCreditPrice } from "@/lib/billing/planConfig";
import { brokerIdForServer } from "./brokers";
import {
  createTradingAccount,
  deleteAccount,
  type MetaapiAccountState,
} from "./metaapiClient";
import {
  getBrokerLink,
  insertBrokerLink,
  replaceBrokerLink,
  type BrokerLinkRow,
} from "./store";

/**
 * The CHARGED link flow — one-time credit charge, atomic with the link.
 *
 * Order of operations, and why:
 *  1. the external MetaAPI account is created FIRST (a failed provisioning
 *     must cost nothing — "link failed = no charge");
 *  2. the broker_links row and the conditional debit then commit in ONE
 *     database transaction, keyed mt5link:<accountId> — the platform-visible
 *     link and its charge exist together or not at all;
 *  3. a failed transaction (balance emptied by a race, DB refusal) is
 *     COMPENSATED: the just-created MetaAPI account is deleted and the
 *     caller gets the named refusal — no link without a charge, no charge
 *     without a link, and the previous link (replace flow) is untouched.
 *
 * One-time means per LINK EVENT: the connection then stays up around the
 * clock with no recurring charge; relinking after an expiry (a new account)
 * charges once again — the ledger UNIQUE on the account-keyed ref makes a
 * double charge for the same account impossible.
 */
export interface LinkChargeDeps {
  create?: typeof createTradingAccount;
  remove?: typeof deleteAccount;
  price?: () => Promise<number>;
}

export type LinkChargeResult =
  | { ok: true; row: BrokerLinkRow; accountId: string; state: MetaapiAccountState; charged: number }
  | { ok: false; code: "insufficient_credits" };

export async function linkBrokerAccountCharged(input: {
  token: string;
  userId: number;
  server: string;
  login: string;
  password: string;
  region?: string;
  hasExistingLink: boolean;
  deps?: LinkChargeDeps;
}): Promise<LinkChargeResult> {
  const create = input.deps?.create ?? createTradingAccount;
  const remove = input.deps?.remove ?? deleteAccount;
  const price = await (input.deps?.price ?? (() => getCreditPrice("mt5_link")))();

  // 1. External provisioning — throws on failure, and nothing was charged.
  const created = await create({
    token: input.token,
    userId: input.userId,
    server: input.server,
    login: input.login,
    password: input.password,
    region: input.region,
  });

  // 2. Row + charge, one transaction.
  try {
    const row = await transaction(async (tx) => {
      const persist = {
        userId: input.userId,
        metaapiAccountId: created.id,
        brokerId: brokerIdForServer(input.server),
        server: input.server,
        state: created.state,
        login: input.login,
      };
      const saved = input.hasExistingLink
        ? await replaceBrokerLink(persist, tx)
        : await insertBrokerLink(persist, tx).catch(async () => {
            const again = await getBrokerLink(input.userId, tx);
            if (!again) throw new Error("Could not persist the broker link.");
            return replaceBrokerLink(persist, tx);
          });
      if (price > 0) {
        const debit = await debitCredits(
          {
            userId: input.userId,
            amount: price,
            kind: "debit_mt5_link",
            ref: `mt5link:${created.id}`,
          },
          tx,
        );
        if (!debit.ok) {
          // Abort the transaction: the row insert rolls back with the charge.
          throw new InsufficientLinkCredits();
        }
      }
      return saved;
    });
    return { ok: true, row, accountId: created.id, state: created.state, charged: price };
  } catch (error) {
    // 3. Compensation: the cloud account must not outlive a refused link.
    await remove({ token: input.token, accountId: created.id }).catch(() => {});
    if (error instanceof InsufficientLinkCredits) {
      return { ok: false, code: "insufficient_credits" };
    }
    throw error;
  }
}

class InsufficientLinkCredits extends Error {
  constructor() {
    super("insufficient_credits");
  }
}
