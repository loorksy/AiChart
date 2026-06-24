import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import type { PublicUser, Conversation } from "@/lib/types";
import {
  getConversation,
  getConversationByPublicId,
  deleteConversation,
  archiveConversation,
  unarchiveConversation,
  updateConversationTitle,
  loadChatMessages,
} from "@/lib/conversations";

type Params = { params: Promise<{ id: string }> };

// Per-user private data — never let a CDN/proxy reuse one user's response.
export const dynamic = "force-dynamic";

/** Headers that forbid any shared/intermediary cache from storing the response. */
const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

/**
 * Resolve the `[id]` segment, which is now an opaque public slug. A purely
 * numeric value is still accepted (legacy links / internal callers) so old
 * bookmarks keep working, but new URLs only ever expose the slug.
 */
async function resolveConversation(
  raw: string,
  user: PublicUser,
): Promise<Conversation | null> {
  if (/^\d+$/.test(raw)) {
    return getConversation(Number(raw), user.id);
  }
  return getConversationByPublicId(raw, user.id);
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePlatformAccess();
    const conv = await resolveConversation((await params).id, user);
    if (!conv) {
      return NextResponse.json(
        { error: "المحادثة غير موجودة." },
        { status: 404, headers: PRIVATE_NO_STORE },
      );
    }
    const messages = await loadChatMessages(conv.id);
    return NextResponse.json(
      { conversation: conv, messages },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requirePlatformAccess();
    const conv = await resolveConversation((await params).id, user);
    if (!conv) {
      return NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 });
    }
    const body = patchSchema.parse(await req.json());
    if (body.title) await updateConversationTitle(conv.id, user.id, body.title);
    if (body.archived === true) await archiveConversation(conv.id, user.id);
    if (body.archived === false) await unarchiveConversation(conv.id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePlatformAccess();
    const conv = await resolveConversation((await params).id, user);
    if (!conv || !(await deleteConversation(conv.id, user.id))) {
      return NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
