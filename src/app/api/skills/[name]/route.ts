import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import {
  deleteUserSkill,
  getUserSkillContent,
  setUserSkillEnabled,
} from "@/lib/agent/skills/userSkillStore";

/** Read / toggle / delete one of the user's own skills. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { name } = await ctx.params;
    const content = await getUserSkillContent(user.id, name);
    if (content == null) {
      return NextResponse.json({ error: "المهارة غير موجودة." }, { status: 404 });
    }
    return NextResponse.json({ name, content });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "الحقل enabled مطلوب." }, { status: 400 });
    }
    const ok = await setUserSkillEnabled(user.id, name, body.enabled);
    if (!ok) {
      return NextResponse.json({ error: "المهارة غير موجودة." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { name } = await ctx.params;
    const ok = await deleteUserSkill(user.id, name);
    if (!ok) {
      return NextResponse.json({ error: "المهارة غير موجودة." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
