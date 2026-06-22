/**
 * Card Composer — the system's NATIVE, model-independent presentation layer.
 *
 * The agent's data tools return structured JSON. This module deterministically
 * turns that structured data into a UI card schema (the ui_schema "Card
 * Protocol", aligned with the A2UI / AG-UI declarative-UI pattern), WITHOUT
 * relying on the model to call render_cards. It works with ANY provider/model
 * because it only inspects the data shapes the tools produced — never the model.
 *
 * Detection is SHAPE-DRIVEN, not tool-name-driven: any tool that returns a
 * familiar shape (e.g. `{ symbols: [...] }`) renders the matching card with no
 * code change. New shapes need exactly one detector here.
 */

export interface UIElement {
  id: string;
  component: string;
  props: Record<string, unknown>;
  children?: UIElement[];
}

export interface ComposedUISchema {
  version: "1.0";
  layout: UIElement[];
}

export interface ToolDatum {
  name: string;
  data: unknown;
}

/** Unwrap a bridge envelope ({ ok, data }) or return the value as-is. */
function unwrap(v: unknown): any {
  if (v && typeof v === "object" && "data" in (v as any) && (v as any).data) {
    return (v as any).data;
  }
  return v;
}

/** Build an `analysis` card from a unified snapshot object. */
function analysisProps(snap: any): Record<string, unknown> {
  return {
    symbol: snap.symbol,
    price: snap.price,
    trend: snap.extra?.trend ?? snap.trend ?? "neutral",
    rsi: snap.extra?.rsi14 ?? snap.rsi,
    macd: snap.extra?.macd ?? snap.macd,
    support: snap.low24h ?? snap.support,
    resistance: snap.high24h ?? snap.resistance,
    summary: snap.summary ?? "",
  };
}

const trendToSignal = (trend: unknown): "buy" | "sell" | "neutral" =>
  trend === "bullish" ? "buy" : trend === "bearish" ? "sell" : "neutral";

/** True when an object looks like a unified single-symbol snapshot. */
function isSnapshot(o: any): boolean {
  return (
    !!o &&
    typeof o === "object" &&
    typeof o.symbol === "string" &&
    (o.extra != null || o.summary != null || o.high24h != null) &&
    o.price != null
  );
}

/** True when an object looks like the multi-timeframe snapshot response. */
function isMultiSnapshot(o: any): boolean {
  return (
    !!o &&
    Array.isArray(o.snapshots) &&
    o.snapshots.some((s: any) => s?.snapshot?.symbol)
  );
}

/** True when an object carries the broker symbol list. */
function isSymbolList(o: any): boolean {
  return (
    !!o &&
    Array.isArray(o.symbols) &&
    o.symbols.length > 0 &&
    o.symbols.some(
      (s: any) =>
        s &&
        typeof s.symbol === "string" &&
        (s.bid != null || s.ask != null || s.spreadPct != null),
    )
  );
}

/** Extract an open-positions array from common shapes. */
function openPositions(o: any): any[] | null {
  const arr =
    (Array.isArray(o?.aichartTrades) && o.aichartTrades) ||
    (Array.isArray(o?.positions) && o.positions) ||
    (Array.isArray(o?.trades) &&
      o.trades.every((t: any) => t?.symbol && t?.side) &&
      o.trades) ||
    null;
  return arr && arr.length ? arr : null;
}

/** Extract an account-overview object from common shapes. */
function accountOf(o: any): any | null {
  const a = o?.account ?? o;
  if (a && (a.balance != null || a.equity != null || a.marginLevel != null)) {
    return a;
  }
  return null;
}

/** True when an object looks like a trade-readiness / risk result. */
function isReadiness(o: any): boolean {
  return (
    !!o &&
    typeof o === "object" &&
    (typeof o.ready === "boolean" || Array.isArray(o.blockers))
  );
}

/**
 * Detectors in priority order. Each finds the LAST datum whose shape matches and
 * builds one or more cards. Components are de-duplicated, so e.g. a multi-TF
 * analysis wins over a single-snapshot analysis.
 */
const DETECTORS: {
  match: (o: any) => boolean;
  build: (o: any, mkId: () => string) => UIElement[];
}[] = [
  {
    match: isMultiSnapshot,
    build: (o, mkId) => {
      const valid = o.snapshots.filter((s: any) => s?.snapshot?.symbol);
      const out: UIElement[] = [
        { id: mkId(), component: "analysis", props: analysisProps(valid[0].snapshot) },
      ];
      out.push({
        id: mkId(),
        component: "mtf_grid",
        props: {
          rows: valid.map((s: any) => ({
            tf: s.interval,
            signal: trendToSignal(s.snapshot.extra?.trend),
          })),
        },
      });
      return out;
    },
  },
  {
    match: isSnapshot,
    build: (o, mkId) => [
      { id: mkId(), component: "analysis", props: analysisProps(o) },
    ],
  },
  {
    match: isSymbolList,
    build: (o, mkId) => [
      { id: mkId(), component: "pair_browser", props: { symbols: o.symbols } },
    ],
  },
  {
    match: (o) => accountOf(o) != null,
    build: (o, mkId) => {
      const a = accountOf(o);
      return [
        {
          id: mkId(),
          component: "account_overview",
          props: {
            balance: a.balance,
            equity: a.equity,
            margin: a.margin ?? a.usedMargin,
            freeMargin: a.freeMargin ?? a.free_margin,
            marginLevel: a.marginLevel ?? a.margin_level,
          },
        },
      ];
    },
  },
  {
    match: (o) => openPositions(o) != null,
    build: (o, mkId) => {
      const positions = openPositions(o)!;
      return [
        {
          id: mkId(),
          component: "positions_table",
          props: {
            positions: positions.map((t: any) => ({
              symbol: t.symbol,
              side: t.side,
              size: t.notional ?? t.size ?? t.quantity,
              pnl: t.pnl ?? t.unrealized_pnl ?? t.profit,
              tradeId: t.id ?? t.tradeId,
            })),
          },
        },
      ];
    },
  },
  {
    match: isReadiness,
    build: (o, mkId) => [
      {
        id: mkId(),
        component: "alert_banner",
        props: {
          type: o.ready === false ? "warning" : "success",
          title: o.ready === false ? "غير جاهز للدخول" : "جاهز للدخول",
          text:
            Array.isArray(o.blockers) && o.blockers.length
              ? o.blockers
                  .map((b: any) => b?.message_ar ?? b?.message ?? String(b))
                  .join(" · ")
              : o.ready === false
                ? "هناك ما يمنع الدخول حالياً."
                : "تحقّقت الجاهزية.",
        },
      },
    ],
  },
];

/**
 * Deterministically compose a card ui_schema from captured tool outputs.
 * Returns null when no data shape is renderable (e.g. plain chat).
 */
export function composeCardSchema(
  toolData: ToolDatum[],
  _recommendations?: unknown[],
): ComposedUISchema | null {
  if (!Array.isArray(toolData) || toolData.length === 0) return null;

  const unwrapped = toolData.map((t) => unwrap(t.data));
  const layout: UIElement[] = [];
  const seen = new Set<string>();
  let i = 0;
  const mkId = () => `auto${i++}`;

  for (const detector of DETECTORS) {
    // Last matching datum wins (most recent data).
    let target: any = null;
    for (let k = unwrapped.length - 1; k >= 0; k--) {
      if (detector.match(unwrapped[k])) {
        target = unwrapped[k];
        break;
      }
    }
    if (target == null) continue;
    for (const el of detector.build(target, mkId)) {
      if (seen.has(el.component)) continue;
      seen.add(el.component);
      layout.push(el);
    }
  }

  return layout.length ? { version: "1.0", layout } : null;
}
