import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  countPushSubscriptions,
  isPushConfigured,
  pushPublicKey,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/push";

const subscribeSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      p256dh: z.string().min(1).max(512),
      auth: z.string().min(1).max(512),
    }),
  })
  .strict();

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) }).strict();

/**
 * Push channel status for this operator.
 *
 * Returns the VAPID public key the browser needs to subscribe, or reports that
 * push is unconfigured — the UI then hides the option instead of offering a
 * button that could never work.
 */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    return NextResponse.json({
      configured: isPushConfigured(),
      public_key: pushPublicKey(),
      devices: await countPushSubscriptions(user.id),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    if (!isPushConfigured()) {
      return NextResponse.json(
        { error: "إشعارات المتصفح غير مُعدّة على الخادم." },
        { status: 503 },
      );
    }
    const body = subscribeSchema.parse(await req.json());
    await savePushSubscription(user.id, {
      endpoint: body.endpoint,
      keys: body.keys,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "اشتراك غير صالح." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = unsubscribeSchema.parse(await req.json());
    await removePushSubscription(user.id, body.endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "endpoint غير صالح." }, { status: 400 });
    }
    return handleError(err);
  }
}
