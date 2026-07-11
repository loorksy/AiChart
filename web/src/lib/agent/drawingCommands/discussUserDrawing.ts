/**
 * Discuss a single, already-resolved USER drawing — talk about it, never edit
 * it and never open a trade. Produces a localized, deterministic description
 * (type, price levels, distance from current price) that an optional LLM pass
 * may refine. No market/risk agents run here.
 */
import type { AppLocale } from "@/lib/i18n";
import { drawingPriceLevels } from "@/lib/chart/drawings/serializeUserDrawings";
import type { SerializedChartDrawing } from "@/lib/chart/drawings/types";
import { callLLM, isLLMConfigured } from "@/lib/llm";
import { sanitizePublicText } from "../activity";

export interface DiscussDrawingInput {
  userMessage: string;
  drawing: SerializedChartDrawing;
  currentPrice?: number | null;
  locale?: AppLocale;
}

function describeType(d: SerializedChartDrawing, locale: AppLocale): string {
  const t = d.type.toLowerCase();
  const isAr = locale !== "en";
  if (/zone|rect|box|range/.test(t)) return isAr ? "منطقة" : "zone";
  if (/trend|ray/.test(t)) return isAr ? "خط اتجاه" : "trend line";
  if (/horizontal|hline|price_line|line/.test(t)) return isAr ? "خط أفقي" : "horizontal line";
  if (/fib/.test(t)) return isAr ? "فيبوناتشي" : "fibonacci";
  return isAr ? "رسم" : "drawing";
}

/** A deterministic, safe description used with or without an LLM. */
export function describeUserDrawing(
  input: DiscussDrawingInput,
): string {
  const locale: AppLocale = input.locale ?? "ar";
  const isAr = locale !== "en";
  const d = input.drawing;
  const levels = drawingPriceLevels(d);
  const kind = describeType(d, locale);
  const label = d.label ? (isAr ? ` («${d.label}»)` : ` ("${d.label}")`) : "";

  const priceText = levels.length
    ? levels.length >= 2
      ? isAr
        ? `بين ${Math.min(...levels)} و${Math.max(...levels)}`
        : `between ${Math.min(...levels)} and ${Math.max(...levels)}`
      : isAr
        ? `عند ${levels[0]}`
        : `at ${levels[0]}`
    : isAr
      ? "بدون سعر واضح"
      : "with no clear price";

  const price = input.currentPrice;
  let distance = "";
  if (price != null && Number.isFinite(price) && levels.length) {
    const nearest = levels.reduce(
      (best, lvl) => (Math.abs(lvl - price) < Math.abs(best - price) ? lvl : best),
      levels[0]!,
    );
    const side = nearest > price ? (isAr ? "فوق" : "above") : (isAr ? "تحت" : "below");
    const pct = price > 0 ? ((Math.abs(nearest - price) / price) * 100).toFixed(2) : "0";
    distance = isAr
      ? ` وهو ${side} السعر الحالي (${price}) بنحو ${pct}%.`
      : ` It sits ${side} the current price (${price}) by about ${pct}%.`;
  }

  return isAr
    ? `أرى ${kind}${label} رسمته أنت ${priceText}.${distance} أخبرني إن أردت أن أحرّكه أو أعدّله أو أحذفه.`
    : `I can see the ${kind}${label} you drew ${priceText}.${distance} Tell me if you'd like me to move, adjust, or delete it.`;
}

export async function discussUserDrawing(
  input: DiscussDrawingInput,
): Promise<string> {
  const deterministic = describeUserDrawing(input);
  if (!isLLMConfigured()) return deterministic;

  const locale: AppLocale = input.locale ?? "ar";
  const isAr = locale !== "en";
  try {
    const res = await callLLM({
      system: isAr
        ? "أنت وكيل شارت داخل Lonora. المستخدم يسألك عن رسم رسمه بنفسه على الشارت. ناقش الرسم بإيجاز بالعربية اعتمادًا فقط على البيانات المرسلة. لا تعطِ توصية شراء/بيع ولا تعدّل الرسم ولا تدّعي رؤية رسومات أخرى."
        : "You are a chart agent inside Lonora. The user is asking about a drawing they made themselves. Discuss it briefly in English using only the provided data. Do not give a buy/sell recommendation, do not edit the drawing, and do not claim to see other drawings.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            question: input.userMessage,
            deterministicSummary: deterministic,
            drawing: {
              type: input.drawing.type,
              label: input.drawing.label,
              priceLevels: drawingPriceLevels(input.drawing),
              symbol: input.drawing.symbol,
              interval: input.drawing.interval,
            },
            currentPrice: input.currentPrice ?? null,
          }),
        },
      ],
      maxTokens: 500,
    });
    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return sanitizePublicText(text) || deterministic;
  } catch {
    return deterministic;
  }
}
