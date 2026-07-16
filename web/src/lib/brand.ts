/** User-facing brand (internal code paths stay `aichart`). */
export const BRAND_NAME = "AiChart";
/**
 * The serving domain shown in legal copy. Kept as a single constant so a DNS
 * migration to a new domain is a one-line change (the current value is the
 * live domain — do NOT display a domain that isn't actually served).
 */
export const BRAND_DOMAIN = "aichart.lork.cloud";
export const BRAND_URL = `https://${BRAND_DOMAIN}/`;
export const BRAND_TAGLINE_AR = "منصة التداول الذكية";
