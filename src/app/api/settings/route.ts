import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getLimits, getSettings, logAudit, updateSettings } from "@/lib/store";
import {
  serializeMarketAssets,
  setMarketAssets,
  setWatchlist,
} from "@/lib/allowedAssets";
import { isOfferedModelRef, parseModelRef } from "@/lib/llm";
import { RISK_PER_TRADE, riskPerTradeSchema } from "@/lib/productModel";

const assetList = z.array(z.string().trim().min(1).max(20)).max(200);

/**
 * Public settings contract. Unknown fields are rejected intentionally so an
 * old client cannot resurrect a removed trading policy through this endpoint.
 */
const settingsPatchSchema = z
  .object({
    per_trade_pct: riskPerTradeSchema.optional(),
    allowed_assets: z
      .union([
        assetList,
        z.object({ forex: assetList.optional(), watchlist: assetList.optional() }).strict(),
      ])
      .optional(),
    // "provider/model" the user picked in the chat composer; null = default.
    preferred_model_ref: z
      .string()
      .trim()
      .regex(
        /^(openai|anthropic|openrouter|tokenrouter)\/[A-Za-z0-9._:/-]{1,120}$/,
        "معرّف نموذج غير صالح.",
      )
      .nullable()
      .optional(),
    send_screenshot: z.boolean().optional(),
    telegram_chat_id: z.string().trim().max(64).nullable().optional(),
    alerts_enabled: z.boolean().optional(),
    alert_trades: z.boolean().optional(),
    alert_signals: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const [settings, limits] = await Promise.all([
      getSettings(user.id),
      getLimits(user.id),
    ]);
    return NextResponse.json({
      settings,
      limits,
      product: { riskPerTrade: RISK_PER_TRADE },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const input = settingsPatchSchema.parse(await request.json());
    if (Object.keys(input).length === 0) {
      return NextResponse.json({ error: "لا توجد حقول للتحديث." }, { status: 400 });
    }

    const before = await getSettings(user.id);
    const patch: Record<string, unknown> = {};

    if (input.per_trade_pct !== undefined) patch.per_trade_pct = input.per_trade_pct;
    if (input.preferred_model_ref !== undefined) {
      // Only the curated catalogue (plus the admin's configured default) may be
      // saved — the regex alone would accept any well-formed id the provider's
      // key happens to serve.
      if (input.preferred_model_ref !== null) {
        const parsed = parseModelRef(input.preferred_model_ref);
        if (!parsed || !(await isOfferedModelRef(parsed))) {
          return NextResponse.json(
            { error: "هذا النموذج غير متاح على المنصة." },
            { status: 400 },
          );
        }
      }
      patch.preferred_model_ref = input.preferred_model_ref;
    }
    if (input.telegram_chat_id !== undefined) patch.telegram_chat_id = input.telegram_chat_id;
    if (input.send_screenshot !== undefined) patch.send_screenshot = input.send_screenshot ? 1 : 0;
    if (input.alerts_enabled !== undefined) patch.alerts_enabled = input.alerts_enabled ? 1 : 0;
    if (input.alert_trades !== undefined) patch.alert_trades = input.alert_trades ? 1 : 0;
    if (input.alert_signals !== undefined) patch.alert_signals = input.alert_signals ? 1 : 0;

    if (input.allowed_assets !== undefined) {
      if (Array.isArray(input.allowed_assets)) {
        patch.allowed_assets = setMarketAssets(before.allowed_assets, input.allowed_assets);
      } else {
        let raw = before.allowed_assets;
        if (input.allowed_assets.forex !== undefined) {
          raw = setMarketAssets(raw, input.allowed_assets.forex);
        }
        if (input.allowed_assets.watchlist !== undefined) {
          raw = setWatchlist(raw, input.allowed_assets.watchlist);
        }
        patch.allowed_assets = raw || serializeMarketAssets({ forex: [] });
      }
    }

    await updateSettings(user.id, patch);
    await logAudit(
      user.id,
      "settings_update",
      JSON.stringify({ fields: Object.keys(patch) }),
    );
    return NextResponse.json({ ok: true, settings: await getSettings(user.id) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(error);
  }
}
