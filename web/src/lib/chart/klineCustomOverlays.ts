/**
 * Custom KLineCharts overlay registrations for Visual Chart Analyst drawings.
 * Each overlay renders on canvas using coordinate points (dataIndex + value).
 */
import { registerOverlay } from "klinecharts";

type Coord = { x: number; y: number };

function poly(coords: Coord[], styles?: Record<string, unknown>) {
  return [{ type: "polygon" as const, attrs: { coordinates: coords }, styles: { style: "stroke_fill", ...styles } }];
}

function line(a: Coord, b: Coord, styles?: Record<string, unknown>) {
  return [{ type: "line" as const, attrs: { coordinates: [a, b] }, styles }];
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  if (!text) return;
  ctx.save();
  ctx.font = "11px sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y - 6);
  ctx.restore();
}

let registered = false;

export function ensureCustomOverlays(): void {
  if (registered) return;
  registered = true;

  const reg = (name: string, createPointFigures: Parameters<typeof registerOverlay>[0]["createPointFigures"]) => {
    try {
      registerOverlay({
        name,
        totalStep: 8,
        needDefaultPointFigure: false,
        needDefaultXAxisFigure: false,
        needDefaultYAxisFigure: false,
        createPointFigures,
      });
    } catch {
      /* already registered */
    }
  };

  reg("rect", ({ coordinates }) => {
    if (coordinates.length < 2) return [];
    const [a, b] = coordinates;
    return poly([
      { x: a!.x, y: a!.y },
      { x: b!.x, y: a!.y },
      { x: b!.x, y: b!.y },
      { x: a!.x, y: b!.y },
    ]);
  });

  reg("rangeBox", ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const [a, b] = coordinates;
    const label = (overlay.extendData as { label?: string })?.label ?? "";
    const color = (overlay.styles as { polygon?: { borderColor?: string } })?.polygon?.borderColor ?? "#6366f1";
    return [
      ...poly(
        [
          { x: a!.x, y: a!.y },
          { x: b!.x, y: a!.y },
          { x: b!.x, y: b!.y },
          { x: a!.x, y: b!.y },
        ],
        { color: `${color}18`, borderColor: color, borderSize: 1 },
      ),
      {
        type: "text" as const,
        attrs: { x: (a!.x + b!.x) / 2, y: a!.y, text: label, align: "center", baseline: "bottom" },
        ignoreEvent: true,
      },
    ];
  });

  reg("polylinePattern", ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const color =
      (overlay.styles as { line?: { color?: string } })?.line?.color ?? "#f59e0b";
    const figures: ReturnType<NonNullable<Parameters<typeof registerOverlay>[0]["createPointFigures"]>> = [];
    for (let i = 0; i < coordinates.length - 1; i++) {
      figures.push(
        ...line(coordinates[i]!, coordinates[i + 1]!, {
          color,
          size: 2,
        }),
      );
    }
    return figures;
  });

  reg("triangle", ({ coordinates, overlay }) => {
    if (coordinates.length < 3) return [];
    const [a, b, c] = coordinates;
    const color =
      (overlay.styles as { polygon?: { borderColor?: string } })?.polygon?.borderColor ?? "#8b5cf6";
    return poly(
      [
        { x: a!.x, y: a!.y },
        { x: b!.x, y: b!.y },
        { x: c!.x, y: c!.y },
      ],
      { color: `${color}15`, borderColor: color, borderSize: 1.5 },
    );
  });

  reg("neckline", ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const color = (overlay.styles as { line?: { color?: string } })?.line?.color ?? "#ef4444";
    return [
      ...line(coordinates[0]!, coordinates[1]!, { color, size: 2, style: "solid" }),
    ];
  });

  reg("channel", ({ coordinates, overlay }) => {
    if (coordinates.length < 4) return [];
    const color = (overlay.styles as { line?: { color?: string } })?.line?.color ?? "#3b82f6";
    return [
      ...line(coordinates[0]!, coordinates[1]!, { color, size: 1.5 }),
      ...line(coordinates[2]!, coordinates[3]!, { color, size: 1.5 }),
    ];
  });

  reg("labeledArrow", ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const [from, to] = coordinates;
    const color = (overlay.styles as { line?: { color?: string } })?.line?.color ?? "#22c55e";
    const label = (overlay.extendData as { label?: string })?.label ?? "";
    const dx = to!.x - from!.x;
    const dy = to!.y - from!.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const head = 8;
    const tip = { x: to!.x, y: to!.y };
    const left = { x: tip.x - ux * head + uy * head * 0.5, y: tip.y - uy * head - ux * head * 0.5 };
    const right = { x: tip.x - ux * head - uy * head * 0.5, y: tip.y - uy * head + ux * head * 0.5 };
    return [
      ...line(from!, to!, { color, size: 2 }),
      ...line(tip, left, { color, size: 2 }),
      ...line(tip, right, { color, size: 2 }),
      {
        type: "text" as const,
        attrs: { x: (from!.x + to!.x) / 2, y: (from!.y + to!.y) / 2, text: label, align: "center" },
        ignoreEvent: true,
      },
    ];
  });

  reg("riskRewardBox", ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];
    const ext = overlay.extendData as {
      label?: string;
      entry?: number;
      stopLoss?: number;
      takeProfit?: number;
      riskReward?: number;
    };
    const [a, b] = coordinates;
    const x1 = Math.min(a!.x, b!.x);
    const x2 = Math.max(a!.x, b!.x);
    const yEntry = a!.y;
    const ySl = b!.y;
    const yTp = ext.takeProfit != null ? yEntry - (ySl - yEntry) * (ext.riskReward ?? 1.5) : yEntry - (ySl - yEntry);
    const profitColor = "#22c55e33";
    const riskColor = "#ef444433";
    const rrLabel = ext.riskReward != null ? `1:${ext.riskReward.toFixed(1)}` : ext.label ?? "";
    return [
      ...poly(
        [
          { x: x1, y: yEntry },
          { x: x2, y: yEntry },
          { x: x2, y: yTp },
          { x: x1, y: yTp },
        ],
        { color: profitColor, borderColor: "#22c55e", borderSize: 1 },
      ),
      ...poly(
        [
          { x: x1, y: yEntry },
          { x: x2, y: yEntry },
          { x: x2, y: ySl },
          { x: x1, y: ySl },
        ],
        { color: riskColor, borderColor: "#ef4444", borderSize: 1 },
      ),
      ...line({ x: x1, y: yEntry }, { x: x2, y: yEntry }, { color: "#3b82f6", size: 1.5 }),
      {
        type: "text" as const,
        attrs: { x: (x1 + x2) / 2, y: yTp, text: rrLabel, align: "center" },
        ignoreEvent: true,
      },
    ];
  });

  reg("ellipse", ({ coordinates }) => {
    if (coordinates.length < 2) return [];
    const [a, b] = coordinates;
    const cx = (a!.x + b!.x) / 2;
    const cy = (a!.y + b!.y) / 2;
    const rx = Math.abs(b!.x - a!.x) / 2;
    const ry = Math.abs(b!.y - a!.y) / 2;
    const steps = 24;
    const coords: Coord[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      coords.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    }
    return poly(coords, { color: "#a855f733", borderColor: "#a855f7", borderSize: 1.5 });
  });

  reg("patternLabel", ({ coordinates, overlay }) => {
    if (coordinates.length < 1) return [];
    const c = coordinates[0]!;
    const label = (overlay.extendData as { label?: string })?.label ?? "";
    return [
      {
        type: "text" as const,
        attrs: { x: c.x, y: c.y, text: label, align: "center", baseline: "middle" },
        ignoreEvent: true,
      },
    ];
  });

  /** Full-width trade level: entry / SL / TP with Arabic label on the chart. */
  reg("tradeLevelLine", ({ coordinates, bounding, overlay }) => {
    if (coordinates.length < 1) return [];
    const y = coordinates[0]!.y;
    const ext = overlay.extendData as { label?: string };
    const color =
      (overlay.styles as { line?: { color?: string } })?.line?.color ?? "#22c55e";
    const label = ext.label ?? "";
    return [
      ...line({ x: 0, y }, { x: bounding.width, y }, { color, size: 2, style: "solid" }),
      {
        type: "text" as const,
        attrs: {
          x: 6,
          y,
          text: label,
          align: "left",
          baseline: "bottom",
        },
        ignoreEvent: true,
      },
    ];
  });
}

export { drawLabel };
