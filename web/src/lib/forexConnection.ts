import { getMtAccountMeta, resolveForexBackendForUser } from "./store";
import type { MtAccountMeta } from "./types";

export interface ForexConnectionView {
  backend: "metaapi" | "mt5local";
  connected: boolean;
  online: boolean;
  mt: MtAccountMeta | null;
}

/** Unified forex connection status for UI (MetaApi or self-hosted MT5). */
export async function getForexConnectionView(
  userId: number,
): Promise<ForexConnectionView> {
  const [backend, mt] = await Promise.all([
    resolveForexBackendForUser(userId),
    getMtAccountMeta(userId),
  ]);
  return {
    backend,
    connected: Boolean(mt),
    online: Boolean(mt?.online),
    mt,
  };
}
