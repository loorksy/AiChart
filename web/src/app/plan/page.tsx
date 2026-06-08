import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getLimits } from "@/lib/store";
import AppShell from "@/components/AppShell";
import { SurfaceCard } from "@/components/ui/shell";
import { Send } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار موافقة الإدارة",
  active: "مفعّل",
  suspended: "موقوف",
};

export default async function PlanPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const limits = await getLimits(user.id);

  return (
    <AppShell email={user.email} role={user.role}>
      <main className="page-shell max-w-lg space-y-4">
        <div>
          <h1 className="page-title">الخطة</h1>
          <p className="page-subtitle">حالة اشتراكك والرصيد</p>
        </div>

        <SurfaceCard className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">حالة الحساب</p>
            <p className="font-serif text-2xl font-bold">
              {STATUS_LABEL[user.status]}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">الرصيد اليومي</p>
            <p className="font-serif text-2xl font-bold">
              {limits.claude_quota}{" "}
              <span className="text-base font-normal text-muted-foreground">
                رسالة / يوم
              </span>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            لتوسيع الرصيد أو تفعيل التنفيذ التلقائي، تواصل مع فريق الإدارة عبر
            تليجرام.
          </p>
          <a
            href="https://t.me/"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary w-full"
          >
            <Send className="h-4 w-4" />
            تواصل للاشتراك
          </a>
        </SurfaceCard>

        <Link
          href="/dashboard"
          className="block text-center text-sm text-muted-foreground hover:text-foreground"
        >
          العودة للوحة
        </Link>
      </main>
    </AppShell>
  );
}
