import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/api";
import { getAdminRole, roleAllows } from "@/lib/adminRoles";
import { initDb, queryOne } from "@/lib/db";
import {
  SUPPORT_CONTENT_TYPES,
  safeAttachmentName,
  supportUploadDir,
} from "@/lib/support/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve one support attachment — to the person who is in that conversation,
 * or to an admin who handles tickets.
 *
 * Both halves matter. A signed-in stranger must not be able to read someone
 * else's screenshot by guessing a name, so the file is looked up through the
 * MESSAGE that carries it and the conversation's owner is checked. And the
 * name is reduced to its basename and compared back, so `../../.env` cannot
 * address anything outside the upload directory.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const user = await requireUser();
    await initDb();
    const { name } = await params;
    const base = safeAttachmentName(name);
    if (!base) return NextResponse.json({ ok: false }, { status: 400 });
    const contentType = SUPPORT_CONTENT_TYPES[base.split(".").pop()!.toLowerCase()]!;

    // Who owns the conversation this file was sent in?
    const owner = await queryOne<{ user_id: number }>(
      `SELECT t.user_id AS user_id
         FROM support_messages m
         JOIN support_tickets t ON t.id = m.ticket_id
        WHERE m.attachment_path = ?
        LIMIT 1`,
      [base],
    );
    if (!owner) return NextResponse.json({ ok: false }, { status: 404 });

    if (owner.user_id !== user.id) {
      // Not theirs — only a ticket-handling admin may read it.
      const allowed =
        user.role === "admin" && roleAllows(await getAdminRole(user.id), "tickets");
      if (!allowed) return NextResponse.json({ ok: false }, { status: 403 });
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(supportUploadDir(), base));
    } catch {
      return NextResponse.json({ ok: false }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType,
        // Never sniffed, never cached by a shared proxy: this is one person's
        // private attachment.
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
