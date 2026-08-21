import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requireUser } from "@/lib/api";
import {
  getNotificationPrefs,
  setNotificationPrefs,
} from "@/lib/resident/notifications";

/** The user's proactive-notification preferences (Phase 6): four categories. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ prefs: await getNotificationPrefs(user.id) });
  } catch (err) {
    return handleError(err);
  }
}

const bodySchema = z.object({
  activation: z.boolean().optional(),
  target: z.boolean().optional(),
  invalidation: z.boolean().optional(),
  news_block: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await req.json());
    return NextResponse.json({
      prefs: await setNotificationPrefs(user.id, body),
    });
  } catch (err) {
    return handleError(err);
  }
}
