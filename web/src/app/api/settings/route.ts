import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { getSettings, getLimits, updateSettings } from "@/lib/store";

const schema = z
  .object({
    mode: z.enum(["advisory", "auto"]),
    approval: z.enum(["manual", "delegate"]),
    experience: z.enum(["expert", "beginner"]),
    style: z.enum(["conservative", "balanced", "aggressive"]),
    max_capital: z.number().min(0),
    per_trade_pct: z.number().min(0.1).max(100),
    max_open_trades: z.number().int().min(1).max(50),
    daily_profit_target_pct: z.number().min(0).max(1000),
    daily_loss_limit_pct: z.number().min(0).max(100),
    monthly_loss_limit_pct: z.number().min(0).max(100),
    allowed_assets: z.array(z.string().max(20)).max(100),
    send_screenshot: z.boolean(),
    telegram_chat_id: z.string().max(64).nullable().optional(),
    kill_switch: z.boolean(),
    alerts_enabled: z.boolean(),
    alert_trades: z.boolean(),
    alert_signals: z.boolean(),
    alert_min_confidence: z.number().int().min(0).max(100),
  })
  .partial();

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      settings: await getSettings(user.id),
      limits: await getLimits(user.id),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const input = schema.parse(await req.json());
    const limits = await getLimits(user.id);

    const patch: Record<string, unknown> = { ...input };

    // Hard caps enforced server-side regardless of what the user submits.
    if (typeof input.max_capital === "number") {
      const cap = limits.max_capital_cap;
      patch.max_capital = cap > 0 ? Math.min(input.max_capital, cap) : input.max_capital;
    }
    if (typeof input.max_open_trades === "number") {
      patch.max_open_trades = Math.min(
        input.max_open_trades,
        limits.max_open_trades_cap,
      );
    }
    // The user cannot enable auto-execution unless the admin granted it.
    if (input.mode === "auto" && limits.can_execute !== 1) {
      patch.mode = "advisory";
    }
    if (Array.isArray(input.allowed_assets)) {
      patch.allowed_assets = JSON.stringify(input.allowed_assets);
    }
    if (typeof input.send_screenshot === "boolean") {
      patch.send_screenshot = input.send_screenshot ? 1 : 0;
    }
    if (typeof input.kill_switch === "boolean") {
      patch.kill_switch = input.kill_switch ? 1 : 0;
    }
    if (typeof input.alerts_enabled === "boolean") {
      patch.alerts_enabled = input.alerts_enabled ? 1 : 0;
    }
    if (typeof input.alert_trades === "boolean") {
      patch.alert_trades = input.alert_trades ? 1 : 0;
    }
    if (typeof input.alert_signals === "boolean") {
      patch.alert_signals = input.alert_signals ? 1 : 0;
    }

    await updateSettings(user.id, patch);
    return NextResponse.json({
      settings: await getSettings(user.id),
      capped:
        input.mode === "auto" && limits.can_execute !== 1
          ? "وضع التنفيذ التلقائي يتطلب موافقة الإدارة. تم الإبقاء على وضع التوصيات."
          : null,
    });
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
