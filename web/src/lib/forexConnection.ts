import { getEaConnectionMeta } from "./eaStore";
import { getForexBackend } from "./brokers/forexBackend";
import { getMtAccountMeta } from "./store";
import type { EaConnectionMeta, MtAccountMeta } from "./types";

export interface ForexConnectionView {
  backend: "metaapi" | "ea";
  connected: boolean;
  online: boolean;
  mt: MtAccountMeta | null;
  ea: EaConnectionMeta | null;
}

/** Unified forex connection status for UI (MetaApi or EA bridge). */
export async function getForexConnectionView(
  userId: number,
): Promise<ForexConnectionView> {
  const backend = getForexBackend();
  if (backend === "metaapi") {
    const mt = await getMtAccountMeta(userId);
    return {
      backend: "metaapi",
      connected: Boolean(mt),
      online: Boolean(mt?.online),
      mt,
      ea: null,
    };
  }
  const ea = await getEaConnectionMeta(userId);
  return {
    backend: "ea",
    connected: Boolean(ea && ea.status !== "revoked"),
    online: Boolean(ea?.online),
    mt: null,
    ea,
  };
}
