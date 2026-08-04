import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BridgeClient,
  BridgeError,
  formatBridgeError,
  formatBridgeResult,
} from "../bridge/client.js";
import {
  assistantResponseFor,
  nextStepFor,
  recoveryFor,
  symbolAdjustments,
} from "./steering.js";

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
    "قواعد Lonora: الذكاء الاصطناعي يختار الاتجاه — شراء أو بيع — ونوع الخطة (فورية أو استباقية أو مشروطة). استخدم get_trade_readiness قبل التنفيذ، والحجم يُحسب من Risk per Trade."
  );
}

function isBridgeFailureBody(
  body: unknown,
): body is { ok: false; error?: { code?: string; [k: string]: unknown } } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { ok?: unknown }).ok === false &&
    "error" in body
  );
}

/** Merge extra steering keys onto a plain-object payload; a no-op for
 *  anything else (arrays, scalars, the live-forex `{ok,forex}` shape). */
function withSteering(data: unknown, extra: Record<string, unknown>): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (Object.keys(extra).length === 0) return data;
  return { ...(data as Record<string, unknown>), ...extra };
}

export function bridgeWrap(
  toolName: string,
  bridge: BridgeClient,
  fn: () => Promise<unknown>,
) {
  return async () => bridgeCall(toolName, {}, fn);
}

/**
 * Every tool call's single path to a formatted MCP result. Beyond the
 * envelope unwrap + text-fallback choice, this is where the shared steering
 * vocabulary (see ./steering.ts) is attached: `next_step` and `adjustments`
 * on success, `recovery_tool`/`recovery_reason` on a recognised bridge error
 * — looked up once here from `toolName`/`args`, not re-derived per call site.
 */
export async function bridgeCall<T>(
  toolName: string,
  args: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
  opts?: { structured?: boolean },
): Promise<ReturnType<typeof formatBridgeResult>> {
  const a = args ?? {};
  try {
    const data = await fn();
    const extra: Record<string, unknown> = {};
    const adjustments = symbolAdjustments(toolName, a.symbol);
    if (adjustments.length) extra.adjustments = adjustments;
    const next = nextStepFor(toolName, a, true, data);
    if (next) extra.next_step = next;
    const assistantResponse = assistantResponseFor(toolName, data);
    if (assistantResponse) extra.assistant_response = assistantResponse;
    return formatBridgeResult(withSteering(data, extra), opts);
  } catch (e) {
    if (e instanceof BridgeError && isBridgeFailureBody(e.body)) {
      const recovery = recoveryFor(e.body.error?.code);
      const extra = recovery
        ? { recovery_tool: recovery.recovery_tool, recovery_reason: recovery.recovery_reason }
        : {};
      return formatBridgeResult(withSteering(e.body, extra));
    }
    return formatBridgeError(e) as ReturnType<typeof formatBridgeResult>;
  }
}
