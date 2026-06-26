import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import type { PublicUser, Conversation } from "@/lib/types";
import {
  getConversation,
  getConversationByPublicId,
  loadChartAnalyses,
} from "@/lib/conversations";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

async function resolveConversation(
  raw: string,
  user: PublicUser,
): Promise<Conversation | null> {
  if (/^\d+$/.test(raw)) {
    return getConversation(Number(raw), user.id);
  }
  return getConversationByPublicId(raw, user.id);
}

/** List chart_analyze assistant messages for the conversation. */
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
    const analyses = await loadChartAnalyses(conv.id);
    return NextResponse.json({ analyses }, { headers: PRIVATE_NO_STORE });
  } catch (err) {
    return handleError(err);
  }
}
