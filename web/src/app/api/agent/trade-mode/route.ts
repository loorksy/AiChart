import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { ApiError, handleError } from "@/lib/api";
import { dispatchAlert } from "@/lib/alerts";
import { getTradeMode, setTradeMode } from "@/lib/agent/tradeMode";

const patchSchema = z
  .object({
    mode: z.enum(["auto", "advisory"]),
    /**
     * Proof the operator actually asked for this. Required for `auto` because
     * it is standing authorisation to place real orders — a mode that valuable
     * must never be set as a side effect of some other call.
     */
    confirmed_by_user: z.boolean().optional(),
    actor: z.enum(["platform", "mcp"]).optional(),
  })
  .strict();

/**
 * The operator's trading mode — one shared state for the platform and MCP.
 *
 * Reading it tells a caller whether to offer execution at all, and whether the
 * operator still needs to be asked which mode they want.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const view = await getTradeMode(userId);
    return NextResponse.json({
      mode: view.mode,
      stored_mode: view.storedMode,
      connected: view.connected,
      needs_choice: view.needsChoice,
      downgraded_reason: view.downgradedReason ?? null,
      updated_at: view.updatedAt,
      modes: {
        auto: "ينفّذ الوكيل توصياته عند تحقق شروطها دون طلب موافقة لكل صفقة.",
        advisory: "تحليل وتوصيات ومتابعة وإشعارات، بدون أي تنفيذ.",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = patchSchema.parse(await req.json());

    if (body.mode === "auto" && body.confirmed_by_user !== true) {
      throw new ApiError(
        400,
        "تفعيل الوضع التلقائي يتطلب تأكيداً صريحاً من المستخدم (confirmed_by_user).",
      );
    }

    const result = await setTradeMode({
      userId,
      mode: body.mode,
      actor: body.actor ?? "platform",
    }).catch((error: unknown) => {
      throw new ApiError(
        409,
        error instanceof Error ? error.message : "تعذّر تغيير وضع التداول.",
      );
    });

    // A change of standing authorisation is itself worth announcing: the
    // operator should never discover from a filled order that auto was on.
    if (result.changed) {
      await dispatchAlert(userId, {
        type: "signal",
        title:
          result.mode === "auto"
            ? "تم تفعيل الوضع التلقائي"
            : "تم إيقاف التنفيذ التلقائي",
        text:
          result.mode === "auto"
            ? "سينفّذ الوكيل توصياته عند تحقق شروطها. يمكنك إيقاف ذلك في أي وقت."
            : "لن يُنفَّذ أي أمر تلقائياً. التحليل والمتابعة والإشعارات مستمرة.",
      }).catch(() => undefined);
    }

    const view = await getTradeMode(userId);
    return NextResponse.json({
      ok: true,
      mode: view.mode,
      connected: view.connected,
      changed: result.changed,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "طلب غير صالح." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
