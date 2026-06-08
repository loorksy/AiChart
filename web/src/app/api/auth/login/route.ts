import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { initDb, queryOne } from "@/lib/db";
import { verifyPassword, setSession } from "@/lib/auth";
import { handleError } from "@/lib/api";
import type { UserRow } from "@/lib/types";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const { email, password } = schema.parse(await req.json());
    await initDb();
    const row = await queryOne<UserRow>(
      "SELECT * FROM users WHERE email = ?",
      [email.toLowerCase()],
    );

    if (!row || !verifyPassword(password, row.password_hash)) {
      return NextResponse.json(
        { error: "البريد أو كلمة المرور غير صحيحة." },
        { status: 401 },
      );
    }

    const token = await setSession({
      sub: row.id,
      email: row.email,
      role: row.role,
    });
    return NextResponse.json({
      user: { id: row.id, email: row.email, role: row.role, status: row.status },
      token,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
