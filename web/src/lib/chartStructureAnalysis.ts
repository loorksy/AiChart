import type { StructureAnalysis } from "./ohlc/structure";
import type { ChartDrawing } from "./chartDrawings";
import { rangeBoxDrawing } from "./analysis/drawings";
import type { OhlcCandle } from "./ohlc/fetchOhlc";

export function formatStructureForPrompt(structure: StructureAnalysis): string {
  const lines = [
    "## بنية السوق (swing detection)",
    structure.summary,
    `البنية: ${structure.structure}`,
  ];
  if (structure.nearestSupport != null) {
    lines.push(`أقرب دعم: ${structure.nearestSupport.toFixed(5)}`);
  }
  if (structure.nearestResistance != null) {
    lines.push(`أقرب مقاومة: ${structure.nearestResistance.toFixed(5)}`);
  }
  for (const s of structure.supports.slice(0, 4)) {
    lines.push(`  دعم ${s.price.toFixed(5)} (${s.touches} لمسة)`);
  }
  for (const r of structure.resistances.slice(0, 4)) {
    lines.push(`  مقاومة ${r.price.toFixed(5)} (${r.touches} لمسة)`);
  }
  return lines.join("\n");
}

/**
 * Minimal seed drawings — range box only, no horizontal line spam.
 * Requires candles for time+price anchoring.
 */
export function structureToSeedDrawings(
  structure: StructureAnalysis,
  candles: OhlcCandle[],
): ChartDrawing[] {
  if (candles.length < 10) return [];

  const drawings: ChartDrawing[] = [];
  const fromIndex = Math.max(0, candles.length - 60);
  const toIndex = candles.length - 1;

  if (
    structure.nearestSupport != null &&
    structure.nearestResistance != null &&
    structure.nearestResistance > structure.nearestSupport
  ) {
    drawings.push(
      rangeBoxDrawing(
        fromIndex,
        toIndex,
        structure.nearestResistance,
        structure.nearestSupport,
        candles,
        62,
        "نطاق سعري",
        "range",
      ),
    );
  }

  return drawings;
}

const SMC_PROMPT_LINES = [
  "ارسم Order Blocks و Fair Value Gaps كـ zone/range_box مع time+price.",
  "ارسم النماذج كـ polyline_pattern + neckline — لا price_line لكل قمة.",
  "كل نقطة تاريخية: time (Unix) + price من جدول الشموع.",
  "liveReasoningLog: 3–7 استنتاجات مرتبطة بما يُرسم.",
];

export function smcPromptBlock(): string {
  return SMC_PROMPT_LINES.join("\n");
}

export function mergeSeedAndAgentDrawings(
  seed: ChartDrawing[],
  agent: ChartDrawing[],
): ChartDrawing[] {
  if (!agent.length) return seed;
  if (!seed.length) return agent;

  const tol = (a: number, b: number) =>
    Math.abs(a - b) <= Math.max(a, b) * 0.001;

  const agentPrices = agent.flatMap((d) =>
    d.points?.map((p) => p.price) ?? (d.price != null ? [d.price] : []),
  );

  const filteredSeed = seed.filter((s) => {
    if (s.type === "range_box" && agent.some((a) => a.type === "range_box")) return false;
    const prices =
      s.points?.map((p) => p.price) ?? (s.price != null ? [s.price] : []);
    return !prices.some((p) =>
      agentPrices.some((ap) => tol(p, ap)),
    );
  });

  return [...filteredSeed, ...agent];
}
