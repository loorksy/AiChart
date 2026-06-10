import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  completeOnboarding,
  getBinanceAccountMeta,
  getSettings,
  isOnboardingDone,
  updateSettings,
} from "@/lib/store";

const schema = z.object({
  experience: z.enum(["beginner", "expert"]).optional(),
  mode: z.enum(["auto", "approval", "direct", "advisory"]).optional(),
  approval: z.enum(["manual", "delegate"]).optional(),
  style: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  max_capital: z.number().min(0).optional(),
  per_trade_pct: z.number().min(1).max(100).optional(),
  max_open_trades: z.number().int().min(1).max(20).optional(),
  daily_profit_target_pct: z.number().min(0).max(100).optional(),
  daily_loss_limit_pct: z.number().min(1).max(50).optional(),
  monthly_loss_limit_pct: z.number().min(1).max(100).optional(),
  finish: z.boolean().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const settings = await getSettings(user.id);
    const binance = await getBinanceAccountMeta(user.id);
    return NextResponse.json({
      done: await isOnboardingDone(user.id),
      hasBinance: Boolean(binance),
      settings,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());

    const patch: Record<string, unknown> = {};
    if (body.experience) patch.experience = body.experience;
    if (body.mode) patch.mode = body.mode === "advisory" ? "approval" : body.mode;
    if (body.approval) patch.approval = body.approval;
    if (body.style) patch.style = body.style;
    if (body.max_capital !== undefined) patch.max_capital = body.max_capital;
    if (body.per_trade_pct !== undefined) patch.per_trade_pct = body.per_trade_pct;
    if (body.daily_loss_limit_pct !== undefined) {
      patch.daily_loss_limit_pct = body.daily_loss_limit_pct;
    }
    if (body.daily_profit_target_pct !== undefined) {
      patch.daily_profit_target_pct = body.daily_profit_target_pct;
    }
    if (body.monthly_loss_limit_pct !== undefined) {
      patch.monthly_loss_limit_pct = body.monthly_loss_limit_pct;
    }
    if (body.max_open_trades !== undefined) {
      patch.max_open_trades = body.max_open_trades;
    }

    if (Object.keys(patch).length) await updateSettings(user.id, patch);

    if (body.finish) {
      await completeOnboarding(user.id);
    }

    return NextResponse.json({ ok: true, done: await isOnboardingDone(user.id) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
