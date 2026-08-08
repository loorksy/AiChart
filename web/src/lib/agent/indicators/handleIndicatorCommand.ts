/**
 * Deterministic "enable indicators" handler — no LLM, no market agents.
 * Parses which studies the message asks for (RSI/EMA/SMA/MACD/BB/ATR/
 * Stochastic/VWAP + a common period like "EMA 50") and returns an
 * AgentFinalResult carrying `studies` for the client to mirror onto the
 * TradingView chart. It NEVER issues a trade recommendation.
 */
import type { AppLocale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { ChartStudy, ChartStudyName } from "@/lib/chart/studies";
import type { AgentFinalResult } from "../types";
import { contextualOptionsFor } from "../contextualOptions";

/** Convert Arabic-Indic digits so "٥٠" parses like "50". */
function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

interface IndicatorSpec {
  name: ChartStudyName;
  /** Boundary-safe Latin token (also matches "ema50"). */
  token?: RegExp;
  /** Additional alias substrings (Arabic + long English names). */
  aliases?: string[];
  /** Study input key a parsed period maps to (omitted → never pass inputs). */
  lengthKey?: string;
}

const SPECS: IndicatorSpec[] = [
  { name: "RSI", token: /rsi/, aliases: ["ار اس اي", "آر إس آي"], lengthKey: "length" },
  { name: "EMA", token: /ema/, aliases: ["متوسط متحرك أسي", "المتوسط الأسي", "موفينج اسي"], lengthKey: "length" },
  { name: "MACD", token: /macd/, aliases: ["الماكد", "ماكد"] },
  { name: "BB", token: /bb/, aliases: ["bollinger", "بولينجر", "بولنجر"], lengthKey: "length" },
  { name: "ATR", token: /atr/, aliases: ["متوسط المدى الحقيقي"], lengthKey: "length" },
  { name: "Stochastic", token: /stochastic|stoch/, aliases: ["ستوكاستك", "استوكاستك"] },
  { name: "VWAP", token: /vwap/, aliases: ["فيواب"] },
  // SMA last: plain "moving average" / "متوسط متحرك" defaults to the simple MA,
  // but only when the EMA spec did not already claim the mention.
  { name: "SMA", token: /sma/, aliases: ["moving average", "متوسط متحرك", "المتوسط المتحرك", "موفينج"], lengthKey: "length" },
];

/** "ema 50", "ema50", "50 ema" → 50. Bounded so unrelated numbers don't bind. */
function periodsForToken(text: string, token: RegExp): number[] {
  const src = token.source;
  const after = new RegExp(`(?:^|[^a-z])(?:${src})[^0-9a-z]{0,6}(\\d{1,3})`, "g");
  const before = new RegExp(`(\\d{1,3})[^0-9a-z]{0,6}(?:${src})(?:[^a-z]|$)`, "g");
  const out = new Set<number>();
  for (const m of text.matchAll(after)) out.add(Number(m[1]));
  for (const m of text.matchAll(before)) out.add(Number(m[1]));
  return [...out].filter((n) => n >= 2 && n <= 500);
}

function tokenMentioned(text: string, spec: IndicatorSpec): boolean {
  if (spec.token && new RegExp(`(^|[^a-z])(?:${spec.token.source})([^a-z]|$)`).test(text)) {
    return true;
  }
  return (spec.aliases ?? []).some((a) => text.includes(a));
}

/** Which studies the message asks for — deterministic, order-stable. */
export function parseRequestedStudies(message: string): ChartStudy[] {
  const text = normalizeDigits(message).toLowerCase();
  const studies: ChartStudy[] = [];
  const claimed = new Set<ChartStudyName>();
  for (const spec of SPECS) {
    if (claimed.has(spec.name) || !tokenMentioned(text, spec)) continue;
    // Plain "moving average" with EMA already claimed is the same mention.
    if (spec.name === "SMA" && claimed.has("EMA") && !/(^|[^a-z])sma([^a-z]|$)/.test(text)) {
      continue;
    }
    claimed.add(spec.name);
    const periods = spec.lengthKey && spec.token ? periodsForToken(text, spec.token) : [];
    if (periods.length === 0) {
      studies.push({ id: `agent-${spec.name.toLowerCase()}`, name: spec.name });
    } else {
      for (const p of periods.slice(0, 3)) {
        studies.push({
          id: `agent-${spec.name.toLowerCase()}-${p}`,
          name: spec.name,
          inputs: { [spec.lengthKey!]: p },
        });
      }
    }
  }
  return studies.slice(0, 8);
}

function studyLabel(s: ChartStudy): string {
  const len = s.inputs?.length;
  return typeof len === "number" ? `${s.name}(${len})` : s.name;
}

export function handleIndicatorCommand(input: {
  userMessage: string;
  locale?: AppLocale;
}): AgentFinalResult {
  const locale: AppLocale = input.locale ?? "ar";
  const studies = parseRequestedStudies(input.userMessage);

  if (studies.length === 0) {
    return {
      decision: "informational",
      confidence: 0.85,
      summary: t(locale, "indicator.which"),
      keyReasons: [],
      riskWarnings: [],
      activityEvents: [],
      options: contextualOptionsFor({ decision: "informational", drawingOnly: true, locale }),
    };
  }

  const list = studies.map(studyLabel).join(locale === "ar" ? "، " : ", ");
  return {
    decision: "informational",
    confidence: 0.9,
    summary: t(locale, "indicator.enabled", { list }),
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
    studies,
    options: contextualOptionsFor({ decision: "informational", drawingOnly: true, locale }),
  };
}
