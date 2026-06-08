import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import {
  createConversation,
  listConversations,
  listArchivedConversations,
} from "@/lib/conversations";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const archived = req.nextUrl.searchParams.get("archived") === "1";
    const conversations = archived
      ? await listArchivedConversations(user.id)
      : await listConversations(user.id);
    return NextResponse.json(conversations);
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  title: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
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
