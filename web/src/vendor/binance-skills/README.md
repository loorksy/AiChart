# Vendored Binance Skills (Web3 data)

These files are vendored verbatim from the official **Binance Skills Hub**:
https://github.com/binance/binance-skills-hub (MIT License).

- `trading-signal.mjs` — on-chain Smart Money trading signals (BSC / Solana).
  Source: `skills/binance-web3/trading-signal/scripts/cli.mjs`
- `crypto-market-rank.mjs` — market rank, social hype, smart-money inflow, etc.
  Source: `skills/binance-web3/crypto-market-rank/scripts/cli.mjs`

They are self-contained, zero-dependency, and call public Binance Web3 endpoints
(no API key required). We import their exported `COMMANDS` and `call` helpers
(the CLI dispatch only runs on direct execution, not when imported).

Used by `src/lib/binanceWeb3.ts` to expose them as agent tools.
