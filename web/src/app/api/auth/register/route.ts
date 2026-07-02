import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { initDb, insertReturningId, queryOne } from "@/lib/db";
import { hashPassword, setSession } from "@/lib/auth";
import { ensureUserDefaults } from "@/lib/store";
import { isSingleUserMode } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { hasPlatformAccess } from "@/lib/platformAccess";
import { normalizeWhatsApp } from "@/lib/phone";

const schema = z.object({
  username: z
    .string()
    .min(3, "اسم المستخدم 3 أحرف على الأقل.")
    .max(32)
    .regex(/^[a-zA-Z0-9_.]+$/, "اسم المستخدم: حروف وأرقام و _ . فقط."),
  whatsapp: z.string().min(8, "رقم واتساب مطلوب."),
  email: z.string().email("بريد إلكتروني غير صالح."),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل."),
});

export async function POST(req: NextRequest) {
  try {
    if (isSingleUserMode()) {
      return NextResponse.json(
        { error: "التسجيل معطّل — المنصة تعمل بوضع المستخدم الواحد." },
        { status: 403 },
      );
    }
    const json = await req.json();
    const { username, whatsapp, email, password } = schema.parse(json);
    const phone = normalizeWhatsApp(whatsapp);
    if (!phone.ok) {
      return NextResponse.json({ error: phone.error }, { status: 400 });
    }

    await initDb();
    const uname = username.toLowerCase();

    const existingEmail = await queryOne("SELECT id FROM users WHERE email = ?", [
      email.toLowerCase(),
    ]);
    if (existingEmail) {
      return NextResponse.json(
        { error: "هذا البريد مسجّل بالفعل." },
        { status: 409 },
      );
    }

    const existingUser = await queryOne(
      "SELECT id FROM users WHERE username = ?",
      [uname],
    );
    if (existingUser) {
      return NextResponse.json(
        { error: "اسم المستخدم محجوز." },
        { status: 409 },
      );
    }

    const existingPhone = await queryOne(
      "SELECT id FROM users WHERE whatsapp_e164 = ?",
      [phone.e164],
    );
    if (existingPhone) {
      return NextResponse.json(
        { error: "رقم واتساب مسجّل مسبقاً." },
        { status: 409 },
      );
    }

    // Public platform: new accounts are active immediately (no admin approval).
    const userId = await insertReturningId(
      `INSERT INTO users (email, password_hash, role, status, username, whatsapp_e164)
       VALUES (?, ?, 'user', 'active', ?, ?)`,
      [email.toLowerCase(), hashPassword(password), uname, phone.e164],
    );
    await ensureUserDefaults(userId);

    await setSession({ sub: userId, email: email.toLowerCase(), role: "user" });
    const publicUser = {
      id: userId,
      email: email.toLowerCase(),
      role: "user" as const,
      status: "active" as const,
      username: uname,
      whatsapp_e164: phone.e164,
      telegram_id: null,
      access_expires_at: null,
      created_at: new Date().toISOString(),
    };
    return NextResponse.json({
      user: publicUser,
      platform_access: hasPlatformAccess(publicUser),
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
