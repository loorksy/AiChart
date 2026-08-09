import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import {
  listUserSkills,
  saveUserSkill,
  MAX_USER_SKILL_BYTES,
} from "@/lib/agent/skills/userSkillStore";

/** The user's own agent skills: list + upload (create/replace by name). */
export async function GET() {
  try {
    const user = await requirePaidAccess();
    return NextResponse.json({ skills: await listUserSkills(user.id) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const body = (await req.json().catch(() => ({}))) as { content?: string };
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) {
      return NextResponse.json(
        { error: "أرسل محتوى SKILL.md في الحقل content." },
        { status: 400 },
      );
    }
    if (content.length > MAX_USER_SKILL_BYTES * 2) {
      return NextResponse.json({ error: "الملف كبير جداً." }, { status: 413 });
    }
    const skill = await saveUserSkill(user.id, content);
    return NextResponse.json({ skill });
  } catch (err) {
    if (err instanceof Error && /الحد|فارغ|name|riskLevel|حجم/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleError(err);
  }
}
