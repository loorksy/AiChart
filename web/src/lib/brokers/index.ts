import type { BrokerKind } from "../markets/types";
import { binanceAdapter } from "./binanceAdapter";
import { binanceFuturesAdapter } from "./binanceFuturesAdapter";
import { eaAdapter } from "./eaAdapter";
import { metaApiAdapter } from "./metaApiAdapter";
import { mt5LocalAdapter } from "./mt5LocalAdapter";
import type { BrokerAdapter } from "./types";

export type { BrokerAdapter, OrderResult, PlaceOrderContext } from "./types";

/** Returns the execution backend for a broker kind (+ spot/futures variant). */
export function getBrokerAdapter(
  kind: BrokerKind,
  marketType: "spot" | "futures" = "spot",
): BrokerAdapter {
  if (kind === "metaapi") return metaApiAdapter;
  if (kind === "mt_ea") return eaAdapter;
  if (kind === "mt5_local") return mt5LocalAdapter;
  return marketType === "futures" ? binanceFuturesAdapter : binanceAdapter;
}
