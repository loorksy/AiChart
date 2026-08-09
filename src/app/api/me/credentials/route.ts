import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, setSession } from "@/lib/auth";
import { requireUser, handleError } from "@/lib/api";
import { initDb, queryOne } from "@/lib/db";
import { getPublicUser, updateUserCredentials } from "@/lib/store";
import { needsMcpCredentials } from "@/lib/userCredentials";

const schema = z
  .object({
    email: z.string().email("بريد إلكتروني غير صالح."),
    password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل."),
    password_confirm: z.string().min(1, "أكّد كلمة المرور."),
  })
  .refine((d) => d.password === d.password_confirm, {
    message: "كلمتا المرور غير متطابقتين.",
    path: ["password_confirm"],
  });

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!needsMcpCredentials(user)) {
      return NextResponse.json(
        { error: "بيانات الدخول مكتملة بالفعل." },
        { status: 400 },
      );
    }

    const body = schema.parse(await req.json());
    const email = body.email.toLowerCase();

    await initDb();
    const existing = await queryOne<{ id: number }>(
      "SELECT id FROM users WHERE email = ? AND id != ?",
      [email, user.id],
    );
    if (existing) {
      return NextResponse.json(
        { error: "هذا البريد مسجّل بالفعل." },
        { status: 409 },
      );
    }

    await updateUserCredentials(user.id, {
      email,
      password_hash: hashPassword(body.password),
    });

    await setSession({ sub: user.id, email, role: user.role });
    const updated = await getPublicUser(user.id);

    return NextResponse.json({
      user: updated,
      needs_mcp_credentials: false,
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
