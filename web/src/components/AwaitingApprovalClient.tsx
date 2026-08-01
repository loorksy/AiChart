"use client";

import { useRouter } from "next/navigation";
import { Clock, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/squareui/button";
import type { AccessBlockReason } from "@/lib/platformAccess";
import { accessBlockMessage } from "@/lib/platformAccess";

const COPY: Record<
  AccessBlockReason,
  { title: string; hint: string; icon: typeof Clock }
> = {
  pending: {
    title: "بانتظار موافقة الإدارة",
    hint: "سجّلت بنجاح. سيُفعَّل حسابك والموصل وتحميل EA بعد موافقة الإدارة.",
    icon: Clock,
  },
  expired: {
    title: "انتهت صلاحية حسابك",
    hint: "تواصل مع الإدارة لتجديد الوصول إلى المنصة والموصل.",
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
    ? "تم ربط تليجرام بنجاح. بانتظار موافقة الإدارة لتفعيل المنصة والموصل."
    : meta.hint;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="motion-rise-in w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-8 text-center elevation-2">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
          <Icon className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-bold">{meta.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
        <p className="mt-4 text-xs text-muted-foreground" dir="ltr">
          {email}
        </p>
        <Button
          variant="outline"
          size="xl"
          onClick={() => void logout()}
          className="mx-auto mt-6"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          تسجيل الخروج
        </Button>
      </div>
    </div>
  );
}
