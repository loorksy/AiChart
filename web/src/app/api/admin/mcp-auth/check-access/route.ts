import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, ApiError } from "@/lib/api";
import { initDb, queryOne } from "@/lib/db";
import {
  getAccessBlockReason,
  hasPlatformAccess,
} from "@/lib/platformAccess";
import { isSyntheticTelegramEmail } from "@/lib/userCredentials";
import type { UserRow } from "@/lib/types";
import { userRowToPublicUser } from "@/lib/userSelect";

const schema = z.object({
  email: z.string().email(),
});

/** Re-check platform access on MCP token refresh (no password). */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.MCP_AUTH_SECRET?.trim();
    if (!secret || secret.length < 16) {
      throw new ApiError(503, "MCP auth غير mفعّل على المنصة.");
    }
    const provided = req.headers.get("x-mcp-auth-secret")?.trim();
    if (!provided || provided !== secret) {
      throw new ApiError(401, "MCP auth secret غير صحيح.");
    }

    const body = schema.parse(await req.json());
    await initDb();
    const row = await queryOne<UserRow>(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      [body.email.toLowerCase()],
    );
    if (!row) {
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 401 });
    }
    if (isSyntheticTelegramEmail(row.email)) {
      return NextResponse.json(
        { ok: false, reason: "needs_credentials" },
        { status: 403 },
      );
    }

    const user = userRowToPublicUser(row);
    if (!hasPlatformAccess(user)) {
      const reason = getAccessBlockReason(user) ?? "pending";
      return NextResponse.json({ ok: false, reason }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      email: row.email,
      access_expires_at: row.access_expires_at,
    });
  } catch (e) {
    return handleError(e);
  }
}
