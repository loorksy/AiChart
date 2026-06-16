import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { updateUserProfile, getPublicUser } from "@/lib/store";
import { normalizeWhatsApp } from "@/lib/phone";
import { initDb, queryOne } from "@/lib/db";

const schema = z.object({
  whatsapp: z.string().min(8),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = schema.parse(await req.json());
    const phone = normalizeWhatsApp(body.whatsapp);
    if (!phone.ok) {
      return NextResponse.json({ error: phone.error }, { status: 400 });
    }
    await initDb();
    const taken = await queryOne(
      "SELECT id FROM users WHERE whatsapp_e164 = ? AND id != ?",
      [phone.e164, user.id],
    );
    if (taken) {
      return NextResponse.json(
        { error: "رقم واتساب مسجّل لحساب آخر." },
        { status: 409 },
      );
    }
    await updateUserProfile(user.id, { whatsapp_e164: phone.e164 });
    return NextResponse.json({ user: await getPublicUser(user.id) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
