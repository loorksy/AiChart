# Currency flags

Square (1:1) flag artwork for the currencies the platform quotes, served as
static SVG so a pair card never waits on a CDN and never leaks a request to a
third party.

Source: [`country-flag-icons`](https://github.com/catamphetamine/country-flag-icons)
(MIT, © @catamphetamine). Only the files for currencies AiChart trades were
vendored — the package itself is not a runtime dependency.

Filenames are the lowercase ISO 3166-1 alpha-2 code (`eu.svg` for the euro).
`src/lib/markets/currencyFlags.ts` owns the ISO 4217 → country mapping; metals
(XAU, XAG, XPT, XPD) have no country and render as a metal disc instead.
