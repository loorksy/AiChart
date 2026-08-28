import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  getChartLayoutById,
  getOrCreateChartLayout,
  listChartLayouts,
  saveChartLayout,
} from "@/lib/store";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { processAgentDrawings } from "@/lib/chart/processDrawings";
import { profileForInterval } from "@/lib/analysisProfile";
import { normalizeInterval } from "@/lib/intervals";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartStudy } from "@/lib/chart/studies";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import {
  withStableCreatedAt,
  type TradePlanAnchorFields,
} from "@/lib/recommendations/anchorTime";
import { tryMintChartEmbedUrl } from "@/lib/embedChartToken";

const pointSchema = z.object({
  price: z.number(),
  time: z.number().nullable().optional(),
  barsAhead: z.number().nullable().optional(),
});

const drawingSchema = z.object({
  type: z.string().min(2).max(32),
  confidence: z.number().min(0).max(100).default(70),
  label: z.string().max(64).nullable().optional(),
  color: z.string().max(24).nullable().optional(),
  semanticRole: z.string().max(32).nullable().optional(),
  patternType: z.string().max(40).nullable().optional(),
  width: z.number().min(1).max(4).optional(),
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
  fill: z.boolean().optional(),
  fill_color: z.string().max(24).nullable().optional(),
  points: z.array(pointSchema).max(10).default([]),
  price: z.number().optional(),
  price2: z.number().optional(),
  price3: z.number().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const studySchema = z.object({
  id: z.string().max(24),
  name: z.enum(["RSI", "EMA", "SMA", "MACD", "BB", "ATR", "Stochastic", "VWAP"]),
  inputs: z
    .record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
    .optional(),
  pane: z.enum(["overlay", "separate"]).optional(),
});

const recommendationSchema = z.object({
  action: z.enum(["buy", "sell", "wait"]),
  entry: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  take_profit: z.number().nullable().optional(),
  confidence: z.number().min(0).max(100).optional(),
  symbol: z.string().max(20).optional(),
});

const postSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9]{8,16}$/).optional(),
  symbol: z.string().min(3).max(20).optional(),
  // min(1): TvChart accepts single-letter intervals ("D"/"W") — min(2) rejected
  // them before normalizeInterval ever saw them.
  interval: z.string().min(1).max(4).optional(),
  dataSource: z.enum(["oanda"]).optional(),
  mode: z.enum(["set", "add", "clear"]).default("set"),
  drawings: z.array(drawingSchema).max(24).optional(),
  studies: z.array(studySchema).max(8).optional(),
  recommendation: recommendationSchema.nullable().optional(),
  targets: z.array(z.number()).max(6).optional(),
});

type LayoutState = Record<string, unknown> & {
  drawings?: ChartDrawing[];
  studies?: ChartStudy[];
  overlays?: unknown[];
  recommendation?: unknown;
  targets?: number[];
  dataSource?: string;
  drawingsCleared?: boolean;
};

function parseState(raw: string | null): LayoutState {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as LayoutState) : {};
  } catch {
    return {};
  }
}

function embedUrlFor(
  userId: number,
  layoutId: string,
  symbol: string,
  interval: string,
): string | null {
  return tryMintChartEmbedUrl({ userId, layoutId, symbol, interval });
}

/** Bridge: list layouts / read one layout's state (for MCP get_chart_state). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      const layouts = await listChartLayouts(userId);
      return NextResponse.json({
        layouts: layouts.map((l) => ({
          id: l.id,
          symbol: l.symbol,
          interval: l.interval,
          updated_at: l.updated_at ?? null,
          url: `/chart/${l.id}?symbol=${encodeURIComponent(l.symbol)}`,
        })),
      });
    }

    const layout = await getChartLayoutById(id, userId);
    if (!layout) {
      return NextResponse.json({ error: "layout غير موجود." }, { status: 404 });
    }
    return NextResponse.json({
      id: layout.id,
      symbol: layout.symbol,
      interval: layout.interval,
      updated_at: layout.updated_at ?? null,
      state: parseState(layout.state_json),
      url: `/chart/${layout.id}?symbol=${encodeURIComponent(layout.symbol)}`,
      embed_url: embedUrlFor(userId, layout.id, layout.symbol, layout.interval),
      bound: true,
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Bridge: MCP drawing gateway — set/add/clear drawings + recommendation on the
 * user's chart layout. Drawings go through the SAME pipeline as AI analysis
 * (time anchoring against real candles → labels → caps → validation), so the
 * open chart renders them as native TradingView shapes on its next live poll.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = postSchema.parse(await req.json());

    const layout = body.id
      ? await getChartLayoutById(body.id, userId)
      : await getOrCreateChartLayout(userId, body.symbol);
    if (!layout) {
      return NextResponse.json({ error: "layout غير موجود." }, { status: 404 });
    }

    const rawSymbol = (body.symbol ?? layout.symbol).toUpperCase();
    const symbol = forexCanonicalKey(rawSymbol);
    const interval = normalizeInterval(body.interval ?? layout.interval);
    const state = parseState(layout.state_json);
    // The platform OANDA feed is the only data pipe.
    state.dataSource = "oanda";

    if (body.mode === "clear") {
      state.drawings = [];
      state.overlays = [];
      state.studies = [];
      // Layout copy only — the tracked recommendation row in the DB is not
      // deleted. The live chart stops painting the P/L box until a new
      // analysis writes drawings/a plan back onto this layout.
      state.recommendation = null;
      state.targets = [];
      state.drawingsCleared = true;
    } else {
      let processed: ChartDrawing[] = [];
      if (body.drawings?.length) {
        const { candles } = await fetchOhlc({
          userId,
          symbol,
          interval,
          market: "forex",
          limit: 300,
          source: "oanda",
        }).catch(() => ({ candles: [] as never[] }));
        const decision = body.recommendation?.action ?? "wait";
        processed = processAgentDrawings(body.drawings as ChartDrawing[], {
          candles,
          decision,
          confidence: body.recommendation?.confidence ?? 70,
          profile: profileForInterval(interval),
          symbol,
          market: "forex",
          sourceTimeframe: interval,
        });
      }

      state.drawings =
        body.mode === "add"
          ? [...((state.drawings as ChartDrawing[]) ?? []), ...processed]
          : processed;
      // Studies: only touched when the caller sends them — a drawings-only
      // "set" must not silently strip the indicators already on the chart.
      if (body.studies !== undefined) {
        const incoming = body.studies as ChartStudy[];
        if (body.mode === "add") {
          const prev = Array.isArray(state.studies) ? state.studies : [];
          const replaced = new Set(incoming.map((s) => s.id));
          state.studies = [
            ...prev.filter((s) => !replaced.has(s.id)),
            ...incoming,
          ].slice(0, 8);
        } else {
          state.studies = incoming;
        }
      }
      if (body.recommendation !== undefined) {
        // withStableCreatedAt: the chart anchors the profit/loss zones at the
        // recommendation's created_at. An MCP re-write of the SAME plan keeps
        // the stored anchor byte-for-byte; only a genuinely new plan is
        // stamped now. Without this every MCP draw re-anchored the zones to
        // the latest candle on the open chart's next poll.
        state.recommendation = body.recommendation
          ? withStableCreatedAt(
              { ...body.recommendation, symbol },
              (state.recommendation ?? null) as TradePlanAnchorFields | null,
            )
          : null;
      }
      if (body.targets !== undefined) state.targets = body.targets;
      if (body.drawings?.length || body.recommendation) {
        state.drawingsCleared = false;
      }
    }
    await saveChartLayout(layout.id, userId, {
      symbol,
      interval,
      state,
    });

    return NextResponse.json({
      ok: true,
      id: layout.id,
      symbol,
      interval,
      drawings_count: Array.isArray(state.drawings) ? state.drawings.length : 0,
      studies_count: Array.isArray(state.studies) ? state.studies.length : 0,
      url: `/chart/${layout.id}?symbol=${encodeURIComponent(symbol)}`,
      embed_url: embedUrlFor(userId, layout.id, symbol, interval),
      bound: true,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
