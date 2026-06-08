/**
 * Adapter around the official Binance Skills Hub Web3 data skills (vendored).
 * These provide on-chain market intelligence (smart-money signals, market
 * rank, social hype) that enrich the agent's decisions beyond pure TA.
 *
 * Public endpoints — no API key required.
 */
import * as tradingSignalMod from "@/vendor/binance-skills/trading-signal.mjs";
import * as marketRankMod from "@/vendor/binance-skills/crypto-market-rank.mjs";

type SkillReq = { url: string; method?: string; body?: unknown; headers?: Record<string, string> };
type CommandMap = Record<string, (p: Record<string, unknown>) => SkillReq>;
type CallFn = (req: SkillReq) => Promise<unknown>;

const tradingSignal = {
  COMMANDS: tradingSignalMod.COMMANDS as unknown as CommandMap,
  call: tradingSignalMod.call as unknown as CallFn,
};
const marketRank = {
  COMMANDS: marketRankMod.COMMANDS as unknown as CommandMap,
  call: marketRankMod.call as unknown as CallFn,
};

export const CHAINS: Record<string, string> = {
  "56": "BSC",
  CT_501: "Solana",
  "8453": "Base",
  "1": "Ethereum",
};

/** On-chain Smart Money buy/sell signals (BSC=56, Solana=CT_501). */
export async function smartMoneySignals(params: {
  chainId: string;
  page?: number;
  pageSize?: number;
}): Promise<unknown> {
  const builder = tradingSignal.COMMANDS["smart-money"];
  return tradingSignal.call(
    builder({ page: 1, pageSize: 30, ...params }),
  );
}

export type MarketRankCommand =
  | "social-hype"
  | "token-rank"
  | "smart-money-inflow"
  | "meme-rank"
  | "address-pnl-rank";

/** Market intelligence: trending tokens, social hype, smart-money inflow, etc. */
export async function cryptoMarketRank(
  command: MarketRankCommand,
  params: Record<string, unknown>,
): Promise<unknown> {
  const builder = marketRank.COMMANDS[command];
  if (!builder) throw new Error(`أمر غير معروف: ${command}`);
  return marketRank.call(builder(params));
}
