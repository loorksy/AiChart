import { NextRequest, NextResponse } from "next/server";
import { verifySignedAction, respondToApproval } from "@/lib/approvalFlow";
import { getIntent } from "@/lib/store";

function htmlPage(title: string, body: string, ok: boolean): string {
  const color = ok ? "#16a34a" : "#dc2626";
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:1.5rem;text-align:center}
h1{color:${color}}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

export async function GET(req: NextRequest) {
  const intentId = Number(req.nextUrl.searchParams.get("intent"));
  const action = req.nextUrl.searchParams.get("action") as "approve" | "reject";
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";

  if (!verifySignedAction(intentId, action, exp, sig)) {
    return new NextResponse(
      htmlPage("رابط غير صالح", "انتهت صلاحية الرابط أو التوقيع غير صحيح.", false),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const intent = await getIntent(intentId);
  if (!intent) {
    return new NextResponse(htmlPage("غير موجود", "طلب الصفقة غير موجود.", false), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const result = await respondToApproval(intent.user_id, intentId, action);

  if (action === "reject") {
    return new NextResponse(
      htmlPage("تم الرفض", `طلب ${intent.symbol} رُفض.`, true),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  if (result.ok) {
    return new NextResponse(
      htmlPage(
        "تم التنفيذ",
        `نُفّذت صفقة ${intent.symbol} (${intent.side}).`,
        true,
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return new NextResponse(
    htmlPage("فشل التنفيذ", result.reason ?? "رفض Risk Guard أو الوسيط.", false),
    { status: 422, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
