import { DEFAULT_MARKET, resolveActiveMarket } from "./marketPolicy";
import { DISPLAY_NAME_AR } from "./gold";
import type { MarketType } from "./markets/types";

/**
 * Context footer for operator-facing cards.
 *
 * This described a linked broker account (leverage, margin mode, live-vs-demo,
 * account number) until execution was removed. None of that exists any more —
 * there is no account. What a recommendations platform can honestly stamp on a
 * card is which instrument the analysis is about, so that is all this carries.
 * The market-data VENDOR is deliberately absent: on operator instruction the
 * data source never appears in user-facing output — it is internal provenance
 * that lives in server logs only.
 */
export interface AccountProfile {
  marketType: MarketType;
  instrument: string;
}

export async function buildAccountProfile(
  _userId: number,
  _symbol?: string,
): Promise<AccountProfile> {
  return {
    marketType: resolveActiveMarket(DEFAULT_MARKET),
    instrument: DISPLAY_NAME_AR,
  };
}

export function accountFooterLines(profile: AccountProfile): string[] {
  return [`الأداة: ${profile.instrument}`];
}
