import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { initDb, queryOne } from "@/lib/db";
import { verifyPassword, setSession } from "@/lib/auth";
import { isSingleUserMode, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { hasPlatformAccess } from "@/lib/platformAccess";
import type { UserRow } from "@/lib/types";

const schema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(1),
});

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Single-user mode: one master password (AICHART_GATE_PASSWORD, falling back
 * to the operator's stored password) signs in as the operator. SaaS mode
 * keeps the classic email + password flow.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = schema.parse(await req.json());
    await initDb();

    let row: UserRow | null = null;
    if (isSingleUserMode()) {
      const operatorId = await resolveAgentUserId();
      row = await queryOne<UserRow>("SELECT * FROM users WHERE id = ?", [
        operatorId,
      ]);
      const gate = process.env.AICHART_GATE_PASSWORD;
      const ok = gate
        ? safeEqual(password, gate)
        : row
          ? verifyPassword(password, row.password_hash)
          : false;
      if (!row || !ok) {
        return NextResponse.json(
          { error: "كلمة المرور غير صحيحة." },
          { status: 401 },
        );
      }
    } else {
      if (!email) {
        return NextResponse.json(
          { error: "البريد الإلكتروني مطلوب." },
          { status: 400 },
        );
      }
      row = await queryOne<UserRow>("SELECT * FROM users WHERE email = ?", [
        email.toLowerCase(),
      ]);
      if (!row || !verifyPassword(password, row.password_hash)) {
        return NextResponse.json(
          { error: "البريد أو كلمة المرور غير صحيحة." },
          { status: 401 },
        );
      }
    }

    const publicUser = {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      username: row.username ?? null,
      whatsapp_e164: row.whatsapp_e164 ?? null,
      telegram_id: row.telegram_id ?? null,
      access_expires_at: row.access_expires_at ?? null,
      created_at: row.created_at,
    };
    const token = await setSession({
      sub: row.id,
      email: row.email,
      role: row.role,
    });
    return NextResponse.json({
      user: publicUser,
      platform_access: hasPlatformAccess(publicUser),
      token,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
