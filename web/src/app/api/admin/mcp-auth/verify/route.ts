import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError, ApiError } from "@/lib/api";
import { verifyPassword } from "@/lib/auth";
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
  password: z.string().min(1),
});

function mcpAuthSecret(req: NextRequest): string | null {
  const secret = process.env.MCP_AUTH_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  const provided = req.headers.get("x-mcp-auth-secret")?.trim();
  if (!provided || provided !== secret) return null;
  return secret;
}

/**
 * Internal endpoint for aichart-mcp OAuth login.
 * Secured by X-MCP-Auth-Secret (same value as MCP_AUTH_SECRET on the MCP process).
 */
export async function POST(req: NextRequest) {
  try {
    if (!mcpAuthSecret(req)) {
      const secret = process.env.MCP_AUTH_SECRET?.trim();
      if (!secret || secret.length < 16) {
        throw new ApiError(503, "MCP auth غير mفعّل على المنصة.");
      }
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
    if (!verifyPassword(body.password, row.password_hash)) {
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 401 });
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
