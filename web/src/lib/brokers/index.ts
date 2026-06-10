import type { BrokerKind } from "../markets/types";
import { binanceAdapter } from "./binanceAdapter";
import { eaAdapter } from "./eaAdapter";
import type { BrokerAdapter } from "./types";

export type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/** Returns the execution backend for a broker kind. */
export function getBrokerAdapter(kind: BrokerKind): BrokerAdapter {
  return kind === "mt_ea" ? eaAdapter : binanceAdapter;
}
