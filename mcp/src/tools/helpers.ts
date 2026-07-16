import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BridgeClient,
  formatBridgeError,
  formatBridgeResult,
} from "../bridge/client.js";

export function readWorkspaceFile(relativePath: string, defaultText = ""): string {
  const candidates = [
    join(process.cwd(), `../agent/workspace/${relativePath}`),
    join(process.cwd(), `agent/workspace/${relativePath}`),
    join(process.cwd(), `../agent/${relativePath.replace(/^\.\.\//, "")}`),
    join(process.cwd(), `agent/${relativePath.replace(/^\.\.\//, "")}`),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      return raw.length > 20000 ? `${raw.slice(0, 20000)}\n...(truncated)` : raw;
    } catch {
      /* try next */
    }
  }
  return defaultText;
}

export function tradingRulesText(): string {
  return readWorkspaceFile(
    "AGENTS.md",
    "قواعد AiChart: الذكاء الاصطناعي يختار BUY/SELL/WAIT. استخدم get_trade_readiness قبل التنفيذ، والحجم يُحسب من Risk per Trade."
  );
}

export function bridgeWrap(bridge: BridgeClient, fn: () => Promise<unknown>) {
  return async () => {
    try {
      return formatBridgeResult(await fn());
    } catch (e) {
      return formatBridgeError(e);
    }
  };
}

export async function bridgeCall<T>(
  fn: () => Promise<T>,
  opts?: { structured?: boolean },
): Promise<ReturnType<typeof formatBridgeResult>> {
  try {
    return formatBridgeResult(await fn(), opts);
  } catch (e) {
    return formatBridgeError(e);
  }
}
