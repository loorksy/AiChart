import { getSettings, getLimits } from "@/lib/store";
import type { PublicUser } from "@/lib/types";

/**
 * Props for the console settings surfaces.
 */
export async function loadConsoleSettingsProps(user: PublicUser) {
  return {
    user,
    settings: await getSettings(user.id),
    limits: await getLimits(user.id),
  };
}
