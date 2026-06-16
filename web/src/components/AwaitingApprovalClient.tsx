"use client";

import { useRouter } from "next/navigation";
import { Clock, LogOut, ShieldAlert } from "lucide-react";
import type { AccessBlockReason } from "@/lib/platformAccess";
import { accessBlockMessage } from "@/lib/platformAccess";

const COPY: Record<
  AccessBlockReason,
  { title: string; hint: string; icon: typeof Clock }
> = {
  pending: {
    title: "بانتظار موافقة الإدارة",
    hint: "سجّلت بنجاح. سيُفعَّل حسابك وMCP وتحميل EA بعد موافقة الأدmin.",
    icon: Clock,
  },
  expired: {
    title: "انتهت صلاحية حسابك",
    hint: "تواصل مع الإدارة لتجديد الوصول (MCP والكونسول).",
    icon: Clock,
  },
  suspended: {
    title: "حساب موقوف",
    hint: accessBlockMessage("suspended"),
    icon: ShieldAlert,
  },
};

export function AwaitingApprovalClient({
  reason,
  email,
  viaTelegram = false,
}: {
  reason: AccessBlockReason;
  email: string;
  viaTelegram?: boolean;
}) {
  const router = useRouter();
  const meta = COPY[reason];
  const Icon = meta.icon;
  const hint = viaTelegram && reason === "pending"
    ? "تم ربط تليجرام بنجاح. بانتظار موافقة الإدارة لتفعيل MCP والكونسول."
    : meta.hint;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
          <Icon className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-bold">{meta.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
        <p className="mt-4 text-xs text-muted-foreground" dir="ltr">
          {email}
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className="btn btn-secondary mx-auto mt-6 gap-2"
        >
          <LogOut className="h-4 w-4" />
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}
