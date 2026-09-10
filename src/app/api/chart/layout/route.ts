import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  getChartLayoutById,
  getOrCreateChartLayout,
  getOrCreateChatChartLayout,
  saveChartLayout,
} from "@/lib/store";
import { initDb } from "@/lib/db";

const CHAT_ID_RE = /^[A-Za-z0-9_:-]{8,64}$/;

function seedParam(raw: string | null, re: RegExp): string | undefined {
  return raw && re.test(raw) ? raw : undefined;
}

/**
 * GET: a layout by `?id=`, the layout of one conversation by `?chat=<chatId>`
 * (created clean on first use — every chat owns its own chart), or the user's
 * most recent one.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await initDb();
    const id = req.nextUrl.searchParams.get("id");
    const chat = req.nextUrl.searchParams.get("chat");
    if (chat != null && !CHAT_ID_RE.test(chat)) {
      return NextResponse.json({ error: "layout not found" }, { status: 404 });
    }
    const layout = id
      ? await getChartLayoutById(id, user.id)
      : chat
        ? await getOrCreateChatChartLayout(user.id, chat, {
            symbol: seedParam(req.nextUrl.searchParams.get("symbol"), /^[A-Za-z0-9._-]{3,20}$/),
            interval: seedParam(req.nextUrl.searchParams.get("interval"), /^[A-Za-z0-9]{2,4}$/),
          })
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
      chat_id: layout.chat_id ?? null,
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
