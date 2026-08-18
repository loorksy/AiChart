/** Hosted MetaAPI credentials page — the only URL Lonora may open. */
export const CONFIG_LINK_ORIGIN = "https://app.metaapi.cloud";

export function isHostedConfigUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.origin === CONFIG_LINK_ORIGIN &&
      parsed.pathname.startsWith("/configure-trading-account-credentials/")
    );
  } catch {
    return false;
  }
}
