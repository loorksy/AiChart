import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { completeOnboarding, getSettings, isOnboardingDone } from "@/lib/store";

const schema = z.object({ finish: z.literal(true) }).strict();

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    return NextResponse.json({
      done: await isOnboardingDone(user.id),
      settings: await getSettings(user.id),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    schema.parse(await request.json());
    await completeOnboarding(user.id);
    return NextResponse.json({ ok: true, done: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(error);
  }
}
