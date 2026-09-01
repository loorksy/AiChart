/** User-facing brand (internal code paths, env vars, and infra identifiers
 *  stay `aichart` — see brand.ts's own history: this product was Lonora
 *  before it was AiChart, and the infra layer was never renamed either time). */
export const BRAND_NAME = "Lonora";
/** Public wordmark — always Latin all-caps. Localized names stay as-is in copy. */
export const BRAND_WORDMARK = "LONORA";
/**
 * The serving domain shown in legal copy. Kept as a single constant so a DNS
 * migration to a new domain is a one-line change (the current value is the
 * live domain — do NOT display a domain that isn't actually served).
 */
export const BRAND_DOMAIN = "aichart.lork.cloud";
export const BRAND_URL = `https://${BRAND_DOMAIN}/`;
export const BRAND_TAGLINE_AR = "منصة التداول الذكية";
