# Broker logos

Optional artwork for the MT5 connect wizard's broker list.

Convention: `/<slug>.png`, where the slug is the broker name lowercased with
every non-alphanumeric run collapsed to a single dash (see `brokerLogoSlug`
in `src/lib/mt5/brokerSearch.ts`). Examples:

- `Exness` → `exness.png`
- `ICMarketsSC` → `icmarketssc.png`
- `RoboForex` → `roboforex.png`

The wizard probes this path at runtime and falls back to a monogram tile when
the file is missing — adding a broker's logo is an asset drop, never a code
change. Square images (≥64×64, transparent background) render best.

Broker logos are the brokers' trademarks. Only add artwork the platform is
allowed to display (broker partner kits or written permission) — do not
scrape marks from the MT5 app or broker sites.
