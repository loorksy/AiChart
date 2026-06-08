import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { initDb, insertReturningId, queryOne } from "@/lib/db";
import { hashPassword, setSession } from "@/lib/auth";
import { ensureUserDefaults } from "@/lib/store";
import { handleError } from "@/lib/api";

const schema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح."),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل."),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { email, password } = schema.parse(json);
    await initDb();

    const existing = await queryOne("SELECT id FROM users WHERE email = ?", [
      email.toLowerCase(),
    ]);
    if (existing) {
      return NextResponse.json(
        { error: "هذا البريد مسجّل بالفعل." },
        { status: 409 },
      );
    }

    const userId = await insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'user', 'pending')",
      [email.toLowerCase(), hashPassword(password)],
    );
    await ensureUserDefaults(userId);

    await setSession({ sub: userId, email: email.toLowerCase(), role: "user" });
    return NextResponse.json({
      user: { id: userId, email: email.toLowerCase(), role: "user", status: "pending" },
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
