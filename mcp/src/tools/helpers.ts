import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BridgeClient,
  formatBridgeError,
  formatBridgeResult,
} from "../bridge/client.js";

export function tradingRulesText(): string {
  const candidates = [
    join(process.cwd(), "../agent/workspace/AGENTS.md"),
    join(process.cwd(), "agent/workspace/AGENTS.md"),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      return raw.length > 12000 ? `${raw.slice(0, 12000)}\n…(مختصر)` : raw;
    } catch {
      /* try next */
    }
  }
  return "قواعد AiChart: تحقق من get_risk_status قبل أي صفقة. Risk Guard يرفض تجاوز الحدود.";
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
): Promise<ReturnType<typeof formatBridgeResult>> {
  try {
    return formatBridgeResult(await fn());
  } catch (e) {
    return formatBridgeError(e);
  }
}
