import { t } from "@/lib/i18n";
import { getPlatformValueAsync } from "@/lib/platformConfig";

/** Platform-config key. Missing / unset / anything other than an explicit on-value means CLOSED. */
export const REGISTRATION_OPEN_KEY = "REGISTRATION_OPEN";

/** Stable machine code on every closed-registration refusal (never a 500). */
export const REGISTRATION_CLOSED_CODE = "REGISTRATION_CLOSED";

const OPEN_VALUES = new Set(["1", "true", "on", "yes"]);

/**
 * New-user signup is closed unless an admin has explicitly turned the
 * platform-config toggle on. A missing key, a blank value, or `"0"` all
 * mean closed — that is the default for new installs and for any box that
 * has never saved the field.
 */
export async function isRegistrationOpen(): Promise<boolean> {
  const raw = (await getPlatformValueAsync("REGISTRATION_OPEN"))?.trim().toLowerCase();
  if (!raw) return false;
  return OPEN_VALUES.has(raw);
}

export class RegistrationClosedError extends Error {
  readonly code = REGISTRATION_CLOSED_CODE;
  readonly status = 403;
  constructor(message?: string) {
    super(message ?? t("ar", "auth.registration_closed"));
    this.name = "RegistrationClosedError";
  }
}

export function isRegistrationClosedError(
  err: unknown,
): err is RegistrationClosedError {
  return (
    !!err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name?: string }).name === "RegistrationClosedError"
  );
}

export async function assertRegistrationOpen(): Promise<void> {
  if (await isRegistrationOpen()) return;
  throw new RegistrationClosedError();
}
