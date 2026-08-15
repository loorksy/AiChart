import { getSettings, getLimits } from "@/lib/store";
import type { PublicUser } from "@/lib/types";

/**
 * Props for the console settings surfaces.
 *
 * The MetaTrader/MetaApi linking props are gone with the execution layer:
 * there is no broker account to link, so there is no wizard to gate.
 */
export async function loadConsoleSettingsProps(user: PublicUser) {
  return {
    user,
    settings: await getSettings(user.id),
    limits: await getLimits(user.id),
  };
}
