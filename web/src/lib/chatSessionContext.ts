import type { TradingSettings, TradingStyle } from "./types";
import { DEFAULT_MARKET, resolveActiveMarket } from "@/lib/marketPolicy";
import { getSettings, updateSettings } from "./store";

export interface ChatSessionContext {
  trading_style?: TradingStyle;
  mode?: "auto" | "approval" | "direct";
  active_market?: "forex";
  response_mode?: "fast" | "expert" | "vision";
  symbol?: string;
}

export interface SessionChange {
  field: string;
  labelAr: string;
  from: string;
  to: string;
}

export interface ApplySessionResult {
  settings: TradingSettings;
  changes: SessionChange[];
}

const STYLE_AR: Record<TradingStyle, string> = {
  scalp: "سكالب",
  day: "يومي",
  swing: "سوينج",
  position: "استثماري",
};

const MODE_AR: Record<string, string> = {
  auto: "تنفيذ تلقائي",
  approval: "موافقة يدوية",
  direct: "مباشر",
};

const MARKET_AR: Record<string, string> = {
  forex: "فوركس",
};

const RESPONSE_AR: Record<string, string> = {
  fast: "سريع",
  expert: "خبير",
  vision: "رؤية (شارت)",
};

function label(
  field: keyof ChatSessionContext,
  value: string | undefined,
): string {
  if (!value) return "—";
  switch (field) {
    case "trading_style":
      return STYLE_AR[value as TradingStyle] ?? value;
    case "mode":
      return MODE_AR[value] ?? value;
    case "active_market":
      return MARKET_AR[value] ?? value;
    case "response_mode":
      return RESPONSE_AR[value] ?? value;
    case "symbol":
      return value.toUpperCase();
    default:
      return value;
  }
}

/**
 * Applies UI session selections to persisted settings and reports what changed.
 * Symbol is session-only (not stored in settings).
 */
export async function applyChatSessionContext(
  userId: number,
  ctx: ChatSessionContext,
): Promise<ApplySessionResult> {
  const before = await getSettings(userId);
  const changes: SessionChange[] = [];
  const patch: Record<string, unknown> = {};

  if (ctx.trading_style && ctx.trading_style !== before.trading_style) {
    changes.push({
      field: "trading_style",
      labelAr: "أسلوب التداول",
      from: label("trading_style", before.trading_style),
      to: label("trading_style", ctx.trading_style),
    });
    patch.trading_style = ctx.trading_style;
  }

  if (ctx.mode && ctx.mode !== before.mode) {
    changes.push({
      field: "mode",
      labelAr: "وضع التنفيذ",
      from: label("mode", before.mode),
      to: label("mode", ctx.mode),
    });
    patch.mode = ctx.mode;
  }

  if (ctx.active_market) {
    const nextMarket = resolveActiveMarket(ctx.active_market);
    const prevMarket = resolveActiveMarket(before.active_market);
    if (nextMarket !== prevMarket) {
      changes.push({
        field: "active_market",
        labelAr: "السوق",
        from: label("active_market", prevMarket),
        to: label("active_market", nextMarket),
      });
      patch.active_market = nextMarket;
    }
  }

  if (Object.keys(patch).length) {
    await updateSettings(userId, patch);
  }

  const settings = Object.keys(patch).length
    ? await getSettings(userId)
    : before;

  return { settings, changes };
}

/** Builds the session block injected into the agent system prompt. */
export function buildSessionPromptBlock(
  ctx: ChatSessionContext | undefined,
  settings: TradingSettings,
  changes: SessionChange[] = [],
): string {
  const market = ctx?.active_market ?? settings.active_market ?? DEFAULT_MARKET;
  const mode = ctx?.mode ?? settings.mode;
  const style = ctx?.trading_style ?? settings.trading_style ?? "day";
  const responseMode = ctx?.response_mode ?? "expert";
  const symbol = ctx?.symbol?.trim().toUpperCase() || null;

  const modeRules =
    mode === "direct"
      ? `- **مباشر**: سجّل التوصية بـ record_recommendation عند الحاجة — **لا** request_approval ولا trade_confirm. **لا بطاقة موافقة**. التنفيذ فقط عند أمر صريح من المستخدم («نفّذ»/«ادخل»/«موافق») عبر open_trade مع approved_by_user=true.`
      : mode === "approval"
        ? `- **موافقة**: record_recommendation يكفي — النظام يعرض بطاقة موافقة. **لا** open_trade إلا بعد موافقة المستخدم أو approved_by_user=true.`
        : `- **تلقائي**: عند جودة الإعداد نفّذ ضمن Risk Guard دون انتظار موافقة يدوية.`;

  const symbolBlock = symbol
    ? `- **الزوج المختار في الجلسة: ${symbol}** — افترضه في التحليل/الصفقة ما لم يذكر المستخدم زوجاً آخر صراحةً. **لا تسأل «أي زوج؟» أو «ما الرمز؟»**.`
    : `- لم يُحدَّد زوج في شريط الجلسة — يمكنك سؤال المستخدم عن الزوج إن لم يذكره في رسالته.`;

  const changeBlock =
    changes.length > 0
      ? `\n## تغيّرت إعدادات الجلسة في هذه الرسالة\n${changes
          .map((c) => `- ${c.labelAr}: ${c.from} → ${c.to}`)
          .join(
            "\n",
          )}\n**اذكر في بداية ردك** (جملة واحدة) أنك لاحظت التغيير — مثال: «لاحظت أنك بدّلت إلى وضع ${label("mode", mode)}».`
      : "";

  return `# إعدادات جلسة الدردشة (من اختيارات المستخدم في الواجهة — التزم حرفياً)
- السوق: ${label("active_market", market)}
- أسلوب الجلسة: ${label("trading_style", style)}
- عمق الرد المختار: ${label("response_mode", responseMode)}
- وضع التنفيذ: ${label("mode", mode)}
${symbolBlock}
${modeRules}
- **لا تغيّر** وضع التنفيذ/السوق/الأسلوب عبر set_trading_mode أو set_active_market — المستخدم يتحكم من شريط الجلسة فقط.
- لا تطلب من المستخدم اختيار وضع تنفيذ أو سوق إذا كانا محدّدين أعلاه.${changeBlock}`;
}
