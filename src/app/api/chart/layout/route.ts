import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  getChartLayoutById,
  getOrCreateChartLayout,
  saveChartLayout,
} from "@/lib/store";
import { initDb } from "@/lib/db";

/** GET: the user's layout (by ?id= or their primary one, created on demand). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await initDb();
    const id = req.nextUrl.searchParams.get("id");
    const layout = id
      ? await getChartLayoutById(id, user.id)
      : await getOrCreateChartLayout(user.id);
    if (!layout) {
      return NextResponse.json({ error: "layout not found" }, { status: 404 });
    }
    let state: unknown = null;
    try {
      state = layout.state_json ? JSON.parse(layout.state_json) : null;
    } catch {
      state = null;
    }
    return NextResponse.json({
      id: layout.id,
      symbol: layout.symbol,
      interval: layout.interval,
      updated_at: layout.updated_at ?? null,
      state,
    });
  } catch (err) {
    return handleError(err);
  }
}

const saveSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9]{8,16}$/),
  symbol: z.string().min(3).max(20).optional(),
  interval: z.string().min(2).max(4).optional(),
  state: z.unknown().optional(),
});

/** POST: persist symbol/interval/drawings so refresh restores the chart. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await initDb();
    const body = saveSchema.parse(await req.json());
    const ok = await saveChartLayout(body.id, user.id, {
      symbol: body.symbol,
      interval: body.interval,
      state: body.state,
    });
    if (!ok) {
      return NextResponse.json({ error: "layout not found" }, { status: 404 });
    }
    // Return the fresh cursor so the client's live-refresh poll doesn't treat
    // its own save as a remote change.
    const saved = await getChartLayoutById(body.id, user.id);
    return NextResponse.json({ ok: true, updated_at: saved?.updated_at ?? null });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
