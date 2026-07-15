import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getSettings, getLimits, updateSettings, logAudit } from "@/lib/store";
import {
  serializeMarketAssets,
  setMarketAssets,
  setWatchlist,
} from "@/lib/allowedAssets";
import { normalizeInterval } from "@/lib/intervals";
import { resolveMaxOpenTrades } from "@/lib/riskLimits";
import {
  detectRiskIncreases,
  resolveRiskLimits,
  SAFE_RISK_DEFAULTS,
  RISK_PRECEDENCE_VERSION,
} from "@/lib/risk/riskPrecedence";

const assetList = z.array(z.string().max(20)).max(200);

const schema = z
  .object({
    mode: z.enum(["auto", "approval", "direct", "advisory"]),
    approval: z.enum(["manual", "delegate"]),
    experience: z.enum(["expert", "beginner"]),
    style: z.enum(["conservative", "balanced", "aggressive"]),
    max_capital: z.number().min(0),
    per_trade_pct: z.number().min(0.1).max(100),
    max_open_trades: z.number().int().min(1).max(1_000_000),
    daily_profit_target_pct: z.number().min(0).max(1000),
    daily_profit_target_usd: z.number().min(0).max(1_000_000),
    daily_loss_limit_pct: z.number().min(0).max(100),
    monthly_loss_limit_pct: z.number().min(0).max(100),
    auto_take_profit_usd: z.number().min(0).max(100_000),
    // Legacy array OR structured forex object.
    allowed_assets: z.union([
      assetList,
      z.object({
        forex: assetList.optional(),
        watchlist: assetList.optional(),
      }),
    ]),
    active_market: z.literal("forex").optional(),
    // User's forex connection method: EA bridge (on their device) vs server-side.
    forex_backend: z.enum(["ea", "mt5local", "metaapi"]).nullable(),
    send_screenshot: z.boolean(),
    telegram_chat_id: z.string().max(64).nullable().optional(),
    // Master riskGuard toggle (1 = enforced/safe, 0 = full-autonomous). Optional
    // so existing settings forms that omit it keep the current value untouched.
    risk_guard_enabled: z.union([z.literal(0), z.literal(1)]).optional(),
    alerts_enabled: z.boolean(),
    alert_trades: z.boolean(),
    alert_signals: z.boolean(),
    alert_min_confidence: z.number().int().min(0).max(100),
    min_confidence: z.number().int().min(0).max(100),
    min_rr: z.number().min(0).max(10),
    scan_poll_minutes: z.number().int().min(0).max(120),
    analysis_interval: z.string().min(2).max(4),
    execution_env_preference: z.enum(["demo", "live"]),
    futures_enabled: z.literal(false).optional(),
    default_leverage: z.number().min(1).max(125),
    /** Required when the patch materially increases risk. */
    confirm_risk_increase: z.boolean().optional(),
    /** Reset user-editable risk fields to safe defaults. */
    reset_to_safe_defaults: z.boolean().optional(),
  })
  .partial();

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const settings = await getSettings(user.id);
    const limits = await getLimits(user.id);
    return NextResponse.json({
      settings,
      limits,
      resolved: resolveRiskLimits(settings, limits),
      precedenceVersion: RISK_PRECEDENCE_VERSION,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const input = schema.parse(await req.json());
    const limits = await getLimits(user.id);
    const before = await getSettings(user.id);

    if (input.reset_to_safe_defaults) {
      const safePatch: Record<string, unknown> = {
        ...SAFE_RISK_DEFAULTS,
        active_market: "forex",
        futures_enabled: 0,
      };
      await updateSettings(user.id, safePatch);
      await logAudit(
        user.id,
        "risk_settings_reset",
        JSON.stringify({
          source: "api/settings",
          actor: user.id,
          before: {
            per_trade_pct: before.per_trade_pct,
            max_open_trades: before.max_open_trades,
            daily_loss_limit_pct: before.daily_loss_limit_pct,
            min_rr: before.min_rr,
            mode: before.mode,
          },
          after: SAFE_RISK_DEFAULTS,
        }),
      );
      const settings = await getSettings(user.id);
      return NextResponse.json({
        settings,
        resolved: resolveRiskLimits(settings, limits),
        reset: true,
      });
    }

    const patch: Record<string, unknown> = {
      ...input,
      active_market: "forex",
      futures_enabled: 0,
    };
    delete patch.confirm_risk_increase;
    delete patch.reset_to_safe_defaults;

    // Hard caps enforced server-side regardless of what the user submits.
    if (typeof input.max_capital === "number") {
      const cap = limits.max_capital_cap;
      patch.max_capital = cap > 0 ? Math.min(input.max_capital, cap) : input.max_capital;
    }
    if (typeof input.max_open_trades === "number") {
      // Clamp to the admin ceiling, but cap=0 means UNLIMITED — keep the user's
      // value as-is instead of collapsing it to 0 (which blocked all trades).
      patch.max_open_trades = resolveMaxOpenTrades(
        input.max_open_trades,
        limits.max_open_trades_cap,
      );
    }
    // Legacy clients may still send "advisory".
    if (input.mode === "advisory") patch.mode = "approval";
    // The user cannot enable auto-execution unless the admin granted it.
    if (input.mode === "auto" && limits.can_execute !== 1) {
      patch.mode = "approval";
    }
    if (input.allowed_assets !== undefined) {
      const current = before;
      if (Array.isArray(input.allowed_assets)) {
        patch.allowed_assets = setMarketAssets(
          current.allowed_assets,
          input.allowed_assets,
        );
      } else {
        const obj = input.allowed_assets;
        let raw = current.allowed_assets;
        if (obj.forex !== undefined) raw = setMarketAssets(raw, obj.forex);
        if (obj.watchlist !== undefined) raw = setWatchlist(raw, obj.watchlist);
        patch.allowed_assets = raw || serializeMarketAssets({ forex: [] });
      }
    }
    if (typeof input.send_screenshot === "boolean") {
      patch.send_screenshot = input.send_screenshot ? 1 : 0;
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
    if (input.analysis_interval) {
      patch.analysis_interval = normalizeInterval(input.analysis_interval);
    }
    if (typeof input.futures_enabled === "boolean") {
      patch.futures_enabled = input.futures_enabled ? 1 : 0;
    }
    // Default leverage is hard-capped by the admin's max_leverage_cap.
    if (typeof input.default_leverage === "number") {
      const leverageCap =
        limits.max_leverage_cap && limits.max_leverage_cap > 0
          ? limits.max_leverage_cap
          : 10;
      patch.default_leverage = Math.min(input.default_leverage, leverageCap);
    }

    const increases = detectRiskIncreases(before, patch);
    if (increases.length > 0 && input.confirm_risk_increase !== true) {
      return NextResponse.json(
        {
          error:
            "زيادة المخاطر تتطلب تأكيداً صريحاً. أعد الإرسال مع confirm_risk_increase=true.",
          code: "RISK_INCREASE_CONFIRMATION_REQUIRED",
          increases,
        },
        { status: 409 },
      );
    }

    await updateSettings(user.id, patch);

    const changed: Record<string, { old: unknown; new: unknown }> = {};
    const beforeRecord = before as unknown as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      if (key === "allowed_assets") continue;
      const oldVal = beforeRecord[key];
      const newVal = patch[key];
      if (oldVal !== newVal) {
        changed[key] = { old: oldVal, new: newVal };
      }
    }
    if (Object.keys(changed).length > 0) {
      await logAudit(
        user.id,
        "risk_settings_update",
        JSON.stringify({
          source: "api/settings",
          actor: user.id,
          confirm_risk_increase: Boolean(input.confirm_risk_increase),
          increases,
          changed,
        }),
      );
    }

    const settings = await getSettings(user.id);
    return NextResponse.json({
      settings,
      resolved: resolveRiskLimits(settings, limits),
      capped:
        input.mode === "auto" && limits.can_execute !== 1
          ? "وضع التنفيذ التلقائي يتطلب موافقة الإدارة. تم الإبقاء على وضع الموافقة اليدوية."
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
