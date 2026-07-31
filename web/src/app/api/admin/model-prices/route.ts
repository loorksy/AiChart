import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, handleError } from "@/lib/api";
import { execute, query, initDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V2-A1 (#90): the prices `usage_events` costs are computed from.
 * GET lists them; PUT upserts one row. Admin-only — these numbers decide
 * what users get charged. No cache to invalidate: the meter looks prices
 * up per call, so an edit applies to the very next LLM call.
 */

export async function GET() {
  try {
    await requireAdmin();
    await initDb();
    const rows = await query(
      "SELECT provider, model, input_usd_per_m, output_usd_per_m, updated_at FROM model_prices ORDER BY provider, model",
    );
    return NextResponse.json({ ok: true, prices: rows });
  } catch (err) {
    return handleError(err);
  }
}

const putSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().min(2).max(128).transform((m) => m.toLowerCase()),
  input_usd_per_m: z.number().min(0).max(10_000),
  output_usd_per_m: z.number().min(0).max(10_000),
});

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    await initDb();
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
        { status: 400 },
      );
    }
    const { provider, model, input_usd_per_m, output_usd_per_m } = parsed.data;
    const updated = await execute(
      "UPDATE model_prices SET input_usd_per_m = ?, output_usd_per_m = ?, updated_at = ? WHERE provider = ? AND model = ?",
      [input_usd_per_m, output_usd_per_m, Date.now(), provider, model],
    );
    if (!updated.changes) {
      await execute(
        "INSERT INTO model_prices (provider, model, input_usd_per_m, output_usd_per_m, updated_at) VALUES (?, ?, ?, ?, ?)",
        [provider, model, input_usd_per_m, output_usd_per_m, Date.now()],
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
