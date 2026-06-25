import type { StructureAnalysis } from "./ohlc/structure";
import type { ChartDrawing } from "./chartDrawings";

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

export function structureToSeedDrawings(
  structure: StructureAnalysis,
): ChartDrawing[] {
  const drawings: ChartDrawing[] = [];
  const lastBar = 0;

  for (const s of structure.supports.slice(0, 3)) {
    drawings.push({
      type: "price_line",
      confidence: Math.min(75, 58 + s.touches * 4),
      label: "دعم",
      points: [{ barsAhead: lastBar, price: s.price }],
      meta: { rationale: `دعم swing — ${s.touches} لمسات`, source: "structure" },
    });
  }
  for (const r of structure.resistances.slice(0, 3)) {
    drawings.push({
      type: "price_line",
      confidence: Math.min(75, 58 + r.touches * 4),
      label: "مقاومة",
      points: [{ barsAhead: lastBar, price: r.price }],
      meta: { rationale: `مقاومة swing — ${r.touches} لمسات`, source: "structure" },
    });
  }

  if (
    structure.nearestSupport != null &&
    structure.nearestResistance != null &&
    structure.nearestResistance > structure.nearestSupport
  ) {
    const mid =
      (structure.nearestSupport + structure.nearestResistance) / 2;
    const height = structure.nearestResistance - structure.nearestSupport;
    drawings.push({
      type: "zone",
      confidence: 62,
      label: "منطقة سيولة",
      points: [
        { barsAhead: -20, price: structure.nearestSupport },
        { barsAhead: 5, price: structure.nearestResistance },
      ],
      meta: {
        rationale: "منطقة بين أقرب دعم ومقاومة",
        source: "structure",
      },
    });
    void mid;
    void height;
  }

  return drawings;
}

const SMC_PROMPT_LINES = [
  "ارسم Order Blocks و Fair Value Gaps كـ type: zone مع label عربي و confidence.",
  "ارسم خطوط الاتجاه والقنوات كـ trend_line أو channel.",
  "علّم BOS/CHoCH ونقاط السيولة كـ marker.",
  "كل عنصر في chart_drawings يحمل label عربي و meta.rationale يشرح سبب الرسم.",
  "factors[] في record_recommendation يجب أن يطابق labels الرسومات.",
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
    const prices =
      s.points?.map((p) => p.price) ?? (s.price != null ? [s.price] : []);
    return !prices.some((p) =>
      agentPrices.some((ap) => tol(p, ap)),
    );
  });

  return [...filteredSeed, ...agent];
}
