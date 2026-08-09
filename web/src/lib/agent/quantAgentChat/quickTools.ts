/**
 * The Quick Tools registry — the single source of truth for the "أدوات سريعة /
 * Quick tools" menu: which tools exist, in which order, with which icon, which
 * i18n keys, and what clicking one actually does.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/components/CopilotWorkbench.vue`'s
 * `systemQuickTasks` / `registeredQuickTasks` / `quickTaskDisplayText`
 * (`:793-883`) and its `handleQuickPrompt` dispatch (`:2442-2514`), plus the
 * skill rows in `backend_api_python/app/services/ai_skill_registry.py`. The
 * eight keys and their fixed order are upstream's, and every label/description
 * is upstream's own translated string (see `qa.quicktool.*` in
 * `lib/i18n/{ar,en}.ts`), not a re-translation.
 *
 * What changed, and why:
 *
 *  - ONE ARRAY, NO REMOTE REGISTRY. Upstream fetches `/api/ai/skills`, seeds a
 *    Map with local fallbacks, overwrites it with the API's rows, then picks
 *    the final list by a hardcoded order array — while still preferring the
 *    LOCAL i18n label/description over the API's. The remote half therefore
 *    contributes only icons and prompts that the local dictionary already
 *    overrides, so it is not ported: this is the order array, made the whole
 *    registry. The grid, the sheet and the orchestrator's dispatch all read
 *    THIS array, so they cannot drift.
 *  - PROMPT RESOLUTION IS LOCAL, BY DESIGN. Upstream's `resolveSkillPrompt`
 *    calls `buildMessageContext()`, a method that does not exist in the
 *    component — every call throws into a bare `catch (_)` and falls back to
 *    the local i18n prompt. Here the local prompt IS the mechanism.
 *  - TWO TOOLS ARE REAL ACTIONS, SIX ARE NOT. Upstream's `market_diagnosis`
 *    bypasses the chat LLM and calls the analysis endpoint; everything else
 *    only fills the composer. That split is kept, with `opportunity_radar`
 *    promoted to a real action because this platform has a watchlist and a
 *    real analysis engine to sweep it with.
 *  - HONESTY OVER PARITY. Upstream's chart review reads an uploaded image, and
 *    its news/macro prompts assume a news feed and a macro series behind the
 *    model. AiChart's chat has no image input and this engine has neither feed,
 *    so chart review ships `unavailable` with the reason on the tile, and the
 *    news/macro/trade-plan prompts carry an explicit "say so instead of naming
 *    headlines / quoting figures / inventing a level" clause plus a `note` on
 *    the tile. A tool that would have to make data up is not shipped as though
 *    it had data.
 *
 * Client-safe on purpose (same discipline as `./types.ts`): no `node:*`, no DB,
 * no React — the browser grid, the browser sheet and the server orchestrator
 * all import this same module.
 */
import { t, type AppLocale } from "@/lib/i18n";

/** Upstream's eight skill ids, in upstream's own fixed display order. */
export const QUANT_AGENT_QUICK_TOOL_KEYS = [
  "market_diagnosis",
  "chart_review",
  "indicator_research",
  "strategy_research",
  "trade_plan",
  "news_research",
  "macro_economic_data",
  "opportunity_radar",
] as const;

export type QuantAgentQuickToolKey = (typeof QUANT_AGENT_QUICK_TOOL_KEYS)[number];

/**
 * What a click does.
 *
 * - `analysis` / `radar` — genuine agent actions: they run the engine and
 *   bypass the chat LLM entirely (see `orchestrator.ts`).
 * - `prompt` — fills the composer draft and stops there. Never auto-sends.
 * - `unavailable` — the tile is shown, disabled, with its reason. Nothing runs.
 */
export type QuantAgentQuickToolAction = "analysis" | "radar" | "prompt" | "unavailable";

/**
 * Icon NAMES, not components: this module is imported by the server
 * orchestrator, which has no business pulling `lucide-react` in. The grid maps
 * each name to its icon through an exhaustive `Record`, so a name added here
 * without a matching icon fails to compile.
 */
export type QuantAgentQuickToolIcon =
  | "line-chart"
  | "image"
  | "code"
  | "clipboard-list"
  | "globe"
  | "radar";

export interface QuantAgentQuickTool {
  key: QuantAgentQuickToolKey;
  /** 1-based position in upstream's fixed order — the array is already sorted by it. */
  order: number;
  icon: QuantAgentQuickToolIcon;
  action: QuantAgentQuickToolAction;
  labelKey: string;
  descriptionKey: string;
  /** Draft text for `prompt` tools. */
  promptKey?: string;
  /** The exact message an `analysis`/`radar` tool sends — also what the orchestrator matches on. */
  commandKey?: string;
  /** An honest caveat rendered under the description (and the reason on an `unavailable` tile). */
  noteKey?: string;
  /** Whether the prompt/command interpolates `{symbol}`. */
  usesSymbol: boolean;
}

function toolKeys(key: QuantAgentQuickToolKey): { labelKey: string; descriptionKey: string } {
  return { labelKey: `qa.quicktool.${key}.label`, descriptionKey: `qa.quicktool.${key}.desc` };
}

export const QUANT_AGENT_QUICK_TOOLS: readonly QuantAgentQuickTool[] = [
  {
    key: "market_diagnosis",
    order: 1,
    icon: "line-chart",
    action: "analysis",
    ...toolKeys("market_diagnosis"),
    commandKey: "qa.quicktool.market_diagnosis.command",
    usesSymbol: true,
  },
  {
    key: "chart_review",
    order: 2,
    icon: "image",
    action: "unavailable",
    ...toolKeys("chart_review"),
    noteKey: "qa.quicktool.chart_review.note",
    usesSymbol: false,
  },
  {
    key: "indicator_research",
    order: 3,
    icon: "line-chart",
    action: "prompt",
    ...toolKeys("indicator_research"),
    promptKey: "qa.quicktool.indicator_research.prompt",
    noteKey: "qa.quicktool.indicator_research.note",
    usesSymbol: true,
  },
  {
    key: "strategy_research",
    order: 4,
    icon: "code",
    action: "prompt",
    ...toolKeys("strategy_research"),
    // Deliberately phrased so `routeQuantAgentChatIntent` reads it as
    // `generate_strategy` on send: this tool's real destination is the guided
    // Composer Coach wizard, which is the platform's own strategy pipeline.
    promptKey: "qa.quicktool.strategy_research.prompt",
    usesSymbol: true,
  },
  {
    key: "trade_plan",
    order: 5,
    icon: "clipboard-list",
    action: "prompt",
    ...toolKeys("trade_plan"),
    promptKey: "qa.quicktool.trade_plan.prompt",
    noteKey: "qa.quicktool.trade_plan.note",
    usesSymbol: true,
  },
  {
    key: "news_research",
    order: 6,
    icon: "globe",
    action: "prompt",
    ...toolKeys("news_research"),
    promptKey: "qa.quicktool.news_research.prompt",
    noteKey: "qa.quicktool.news_research.note",
    usesSymbol: true,
  },
  {
    key: "macro_economic_data",
    order: 7,
    icon: "globe",
    action: "prompt",
    ...toolKeys("macro_economic_data"),
    promptKey: "qa.quicktool.macro_economic_data.prompt",
    noteKey: "qa.quicktool.macro_economic_data.note",
    usesSymbol: false,
  },
  {
    key: "opportunity_radar",
    order: 8,
    icon: "radar",
    action: "radar",
    ...toolKeys("opportunity_radar"),
    commandKey: "qa.quicktool.opportunity_radar.command",
    usesSymbol: false,
  },
] as const;

export function quantAgentQuickTool(key: QuantAgentQuickToolKey): QuantAgentQuickTool {
  const tool = QUANT_AGENT_QUICK_TOOLS.find((entry) => entry.key === key);
  // Unreachable: the array is exhaustive over the key union by construction,
  // and `quickTools.test.ts` asserts exactly that.
  if (!tool) throw new Error(`unknown quant agent quick tool: ${key}`);
  return tool;
}

/** The two tools that actually run the engine rather than filling the composer. */
export type QuantAgentQuickToolCommandAction = Extract<QuantAgentQuickToolAction, "analysis" | "radar">;

export function isQuantAgentQuickToolCommand(
  tool: QuantAgentQuickTool,
): tool is QuantAgentQuickTool & { action: QuantAgentQuickToolCommandAction; commandKey: string } {
  return tool.action === "analysis" || tool.action === "radar";
}

/**
 * What the UI should do with a click. Pure — the caller performs the effect, so
 * the mapping itself is testable without a DOM: `draft` fills the composer and
 * nothing else, `send` submits the message (only ever the two real actions),
 * `unavailable` shows the reason.
 */
export type QuantAgentQuickToolDispatch =
  | { kind: "draft"; tool: QuantAgentQuickTool; text: string }
  | { kind: "send"; tool: QuantAgentQuickTool; text: string }
  | { kind: "unavailable"; tool: QuantAgentQuickTool; reason: string };

export interface QuantAgentQuickToolContext {
  locale: AppLocale;
  /** The composer's focused pair — the only symbol a tool is ever scoped to. */
  symbol: string;
}

export function resolveQuantAgentQuickToolDispatch(
  tool: QuantAgentQuickTool,
  context: QuantAgentQuickToolContext,
): QuantAgentQuickToolDispatch {
  const replacements = { symbol: context.symbol };
  if (isQuantAgentQuickToolCommand(tool)) {
    return { kind: "send", tool, text: t(context.locale, tool.commandKey, replacements) };
  }
  if (tool.action === "prompt" && tool.promptKey) {
    return { kind: "draft", tool, text: t(context.locale, tool.promptKey, replacements) };
  }
  return {
    kind: "unavailable",
    tool,
    reason: tool.noteKey ? t(context.locale, tool.noteKey) : t(context.locale, "qa.quicktool.unavailable"),
  };
}

// --- Recognising a dispatched command on the server ---

/**
 * Both locales are checked regardless of the turn's own locale: the message is
 * persisted text, and a session can be reopened after the user switches
 * language. Two locales × two command tools is four regexes, built once.
 */
const COMMAND_MATCH_LOCALES: readonly AppLocale[] = ["ar", "en"];

/** Collapses the whitespace differences a copy/paste round trip introduces. */
function normalizeCommandText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function commandPattern(template: string): RegExp {
  const escaped = normalizeCommandText(template).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `{symbol}` survives escaping as `\{symbol\}`; it becomes the one capture.
  const withSymbol = escaped.replace(/\\\{symbol\\\}/g, "(.+?)");
  return new RegExp(`^${withSymbol}$`, "i");
}

interface CompiledCommand {
  key: QuantAgentQuickToolKey;
  action: QuantAgentQuickToolCommandAction;
  pattern: RegExp;
}

let compiledCommands: CompiledCommand[] | null = null;

function commands(): CompiledCommand[] {
  if (compiledCommands) return compiledCommands;
  const compiled: CompiledCommand[] = [];
  for (const tool of QUANT_AGENT_QUICK_TOOLS) {
    if (!isQuantAgentQuickToolCommand(tool)) continue;
    for (const locale of COMMAND_MATCH_LOCALES) {
      compiled.push({
        key: tool.key,
        action: tool.action,
        pattern: commandPattern(t(locale, tool.commandKey)),
      });
    }
  }
  compiledCommands = compiled;
  return compiled;
}

export interface QuantAgentQuickToolCommandMatch {
  key: QuantAgentQuickToolKey;
  action: QuantAgentQuickToolCommandAction;
  /** The `{symbol}` the command carried, when it has one. */
  symbol: string | null;
}

/**
 * Recognises a message that a Quick Tool tile dispatched.
 *
 * Deliberately an EXACT match against the tool's own command string rather than
 * loose keyword matching: the tile and this matcher read the same i18n key, so
 * a dispatched command always matches, while an edited or hand-typed sentence
 * that merely resembles one never does. Failing closed matters here — a false
 * positive on the radar would run a watchlist-wide sweep nobody asked for.
 *
 * This is not a second intent router: `routeQuantAgentChatIntent` still decides
 * every message this returns `null` for, and is untouched.
 */
export function matchQuantAgentQuickToolCommand(message: string): QuantAgentQuickToolCommandMatch | null {
  const normalized = normalizeCommandText(message);
  if (!normalized) return null;
  for (const command of commands()) {
    const match = normalized.match(command.pattern);
    if (!match) continue;
    return { key: command.key, action: command.action, symbol: match[1]?.trim() || null };
  }
  return null;
}
