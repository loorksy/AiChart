import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getConversation,
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

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requirePlatformAccess();
    const id = Number((await params).id);
    const conv = await getConversation(id, user.id);
    if (!conv) {
      return NextResponse.json(
        { error: "المحادثة غير موجودة." },
        { status: 404, headers: PRIVATE_NO_STORE },
      );
    }
    const messages = await loadChatMessages(id);
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
    const id = Number((await params).id);
    const conv = await getConversation(id, user.id);
    if (!conv) {
      return NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 });
    }
    const body = patchSchema.parse(await req.json());
    if (body.title) await updateConversationTitle(id, user.id, body.title);
    if (body.archived === true) await archiveConversation(id, user.id);
    if (body.archived === false) await unarchiveConversation(id, user.id);
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
    const id = Number((await params).id);
    if (!(await deleteConversation(id, user.id))) {
      return NextResponse.json({ error: "المحادثة غير موجودة." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
