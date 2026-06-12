import { callAnthropic } from "./anthropic";
import {
  countOpenTrades,
  getSettings,
  todayRealizedPnlPct,
  todayRealizedPnlUsd,
} from "./store";
import { formatLessonsForPrompt } from "./tradeMemory";
import type {
  CommitteePersonaVote,
  CommitteeResult,
  Recommendation,
  TradeLessonMatch,
} from "./types";

function extractText(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n")
    .trim();
}

function defaultVote(v: CommitteePersonaVote["vote"]): CommitteePersonaVote {
  return { vote: v, confidence: 50, rationale_ar: "تقييم افتراضي — فشل تحليل اللجنة." };
}

function parseCommitteeJson(raw: string): Omit<CommitteeResult, "veto" | "autoBlocked"> {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0]! : trimmed) as {
    aggressive?: CommitteePersonaVote;
    riskOfficer?: CommitteePersonaVote;
    macro?: CommitteePersonaVote;
    summary_ar?: string;
  };
  return {
    aggressive: parsed.aggressive ?? defaultVote("wait"),
    riskOfficer: parsed.riskOfficer ?? defaultVote("wait"),
    macro: parsed.macro ?? defaultVote("wait"),
    summary_ar: parsed.summary_ar ?? "لم تُولَّد ملخص اللجنة.",
  };
}

export function committeeBlocksAuto(rec: Recommendation): boolean {
  if (!rec.committee_json) return false;
  try {
    const c = JSON.parse(rec.committee_json) as CommitteeResult;
    return c.veto === true || c.riskOfficer?.vote === "reject";
  } catch {
    return false;
  }
}

export function committeeSummaryTelegram(rec: Recommendation): string | null {
  if (!rec.committee_json) return null;
  try {
    const c = JSON.parse(rec.committee_json) as CommitteeResult;
    const line = (name: string, v: CommitteePersonaVote) =>
      `${name}: ${v.vote} (${v.confidence}%) — ${v.rationale_ar}`;
    return [
      "🗳️ <b>لجنة التداول</b>",
      line("عدواني", c.aggressive),
      line("مخاطر", c.riskOfficer),
      line("ماكرو", c.macro),
      c.summary_ar,
    ].join("\n");
  } catch {
    return null;
  }
}

/**
 * Single structured LLM call — three persona votes above riskGuard (not a replacement).
 */
export async function evaluateCommittee(
  userId: number,
  rec: Recommendation,
  lessons: TradeLessonMatch[] = [],
): Promise<CommitteeResult> {
  const settings = await getSettings(userId);
  const effectiveCapital = settings.max_capital;
  const [openTrades, todayPct, todayUsd] = await Promise.all([
    countOpenTrades(userId),
    todayRealizedPnlPct(userId, effectiveCapital),
    todayRealizedPnlUsd(userId),
  ]);

  const lessonsBlock = formatLessonsForPrompt(lessons);
  const system = [
    "أنت لجنة تداول من ثلاث شخصيات في JSON واحد.",
    "الشخصيات: aggressive (فرص سريعة)، riskOfficer (حماية رأس المال — له حق النقض)، macro (سياق أخبار/مزاج).",
    "كل شخصية: vote = approve|reject|wait, confidence 0-100, rationale_ar جملة أو جملتان.",
    "أعد JSON فقط: {\"aggressive\":{...},\"riskOfficer\":{...},\"macro\":{...},\"summary_ar\":\"...\"}",
  ].join("\n");

  const userMsg = [
    `التوصية: ${rec.symbol} ${rec.action} ثقة ${rec.confidence}%`,
    rec.timeframe ? `الإطار: ${rec.timeframe}` : "",
    rec.pattern_name ? `النمط: ${rec.pattern_name}` : "",
    rec.rationale ? `المنطق: ${rec.rationale}` : "",
    `وضع التداول: ${settings.mode} · أسلوب: ${settings.style}`,
    `صفقات مفتوحة: ${openTrades}/${settings.max_open_trades}`,
    `PnL اليوم: ${todayUsd.toFixed(2)} (${todayPct.toFixed(1)}%)`,
    lessonsBlock,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await callAnthropic({
      system,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 900,
    });
    const parsed = parseCommitteeJson(extractText(res.content));
    const veto = parsed.riskOfficer.vote === "reject";
    const autoBlocked =
      veto ||
      !(
        (parsed.aggressive.vote === "approve" ||
          parsed.macro.vote === "approve") &&
        parsed.riskOfficer.vote !== "reject"
      );
    return { ...parsed, veto, autoBlocked };
  } catch (e) {
    console.error("[committee] evaluate failed", e);
    const risk = defaultVote("wait");
    return {
      aggressive: defaultVote("wait"),
      riskOfficer: risk,
      macro: defaultVote("wait"),
      summary_ar: "تعذّر تشغيل اللجنة — انتظر موافقة يدوية.",
      veto: false,
      autoBlocked: true,
    };
  }
}
