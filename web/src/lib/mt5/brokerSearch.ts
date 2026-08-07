/**
 * Grouping for the MT5 connect wizard's broker search — pure, so the API
 * route and tests share one implementation.
 */

export type BrokerGroup = { name: string; servers: string[] };

/**
 * MetaApi server names are `<Broker>-<Variant>` ("Exness-MT5Real8",
 * "ICMarketsSC-Demo"). The broker is the part before the first dash; a
 * dashless name is its own broker. Grouping is presentation only — what we
 * store and connect with is always the FULL server name.
 */
export function groupServersByBroker(servers: string[]): BrokerGroup[] {
  const groups = new Map<string, BrokerGroup>();
  for (const server of servers) {
    const name = server.split("-")[0]?.trim() || server;
    const key = name.toLowerCase();
    const group = groups.get(key);
    if (group) {
      if (!group.servers.includes(server)) group.servers.push(server);
    } else {
      groups.set(key, { name, servers: [server] });
    }
  }
  return [...groups.values()];
}

/**
 * Stable monogram for a broker without a bundled logo: first two letters of
 * the name, the way the official MT5 app falls back when a broker has no
 * artwork. Deterministic so the same broker always shows the same mark.
 */
export function brokerMonogram(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}]/gu, "");
  return (clean.slice(0, 2) || "MT").toUpperCase();
}

/**
 * Local logo path convention: /brokers/<slug>.png (see public/brokers).
 * The component tries this image and falls back to the monogram on error —
 * logos are an asset-drop away, never a code change.
 */
export function brokerLogoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
