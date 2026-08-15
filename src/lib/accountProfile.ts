import { DEFAULT_MARKET, resolveActiveMarket } from "./marketPolicy";
import { DISPLAY_NAME_AR } from "./gold";
import type { MarketType } from "./markets/types";

/**
 * Context footer for operator-facing cards.
 *
 * This described a linked broker account (leverage, margin mode, live-vs-demo,
 * account number) until execution was removed. None of that exists any more —
 * there is no account. What a recommendations platform can honestly stamp on a
 * card is which instrument and which data source the analysis came from, so
 * that is all this carries now.
 */
export interface AccountProfile {
  marketType: MarketType;
  instrument: string;
  dataSource: string;
}

export async function buildAccountProfile(
  _userId: number,
  _symbol?: string,
): Promise<AccountProfile> {
  return {
    marketType: resolveActiveMarket(DEFAULT_MARKET),
    instrument: DISPLAY_NAME_AR,
    dataSource: "OANDA",
  };
}

export function accountFooterLines(profile: AccountProfile): string[] {
  return [`الأداة: ${profile.instrument}`, `مصدر البيانات: ${profile.dataSource}`];
}
