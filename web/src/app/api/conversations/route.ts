import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  createConversation,
  listConversations,
  listArchivedConversations,
} from "@/lib/conversations";

// Per-user list — never cacheable by a shared/intermediary layer.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const archived = req.nextUrl.searchParams.get("archived") === "1";
    const conversations = archived
      ? await listArchivedConversations(user.id)
      : await listConversations(user.id);
    return NextResponse.json(conversations, {
      headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" },
    });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  title: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const conv = await createConversation(user.id, body.title);
    return NextResponse.json(conv);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
