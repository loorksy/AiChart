import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, ApiError } from "@/lib/api";
import { verifyPassword } from "@/lib/auth";
import { initDb, queryOne } from "@/lib/db";
import type { UserRow } from "@/lib/types";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Internal endpoint for aichart-mcp OAuth login.
 * Secured by X-MCP-Auth-Secret (same value as MCP_AUTH_SECRET on the MCP process).
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.MCP_AUTH_SECRET?.trim();
    if (!secret || secret.length < 16) {
      throw new ApiError(503, "MCP auth غير مفعّل على المنصة.");
    }
    const provided = req.headers.get("x-mcp-auth-secret")?.trim();
    if (!provided || provided !== secret) {
      throw new ApiError(401, "MCP auth secret غير صحيح.");
    }

    const body = schema.parse(await req.json());
    await initDb();
    const row = await queryOne<UserRow>(
      "SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1",
      [body.email.toLowerCase()],
    );
    if (!row || !verifyPassword(body.password, row.password_hash)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    return NextResponse.json({ ok: true, email: row.email });
  } catch (e) {
    return handleError(e);
  }
}
