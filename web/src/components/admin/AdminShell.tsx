"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  LogOut,
  Menu,
  Shield,
  X,
} from "lucide-react";
import { ADMIN_NAV } from "@/components/admin/adminNav";
import { cn } from "@/lib/utils";

export default function AdminShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        مركز التحكّم
      </p>
      {ADMIN_NAV.map((item) => {
        const active =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition",
              active
                ? "bg-primary/15 font-semibold text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="admin-console flex min-h-dvh bg-[#050505] text-foreground">
      <aside className="hidden w-56 shrink-0 flex-col border-l border-white/8 bg-[#0a0a0a] md:flex">
        <div className="border-b border-white/8 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">AiChart Admin</p>
              <p className="text-[10px] text-muted-foreground">لوحة الإدارة</p>
            </div>
          </div>
        </div>
        {nav}
        <div className="mt-auto border-t border-white/8 p-3 space-y-1">
          <Link
            href="/chat"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            العودة للمنصة
          </Link>
          <p className="truncate px-3 text-[10px] text-muted-foreground" dir="ltr">
            {email}
          </p>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            خروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/8 bg-[#0a0a0a]/80 px-4 py-3 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="القائمة"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs text-muted-foreground md:hidden">AiChart Admin</p>
              <h1 className="text-sm font-semibold md:text-base">
                {ADMIN_NAV.find((n) =>
                  "exact" in n && n.exact
                    ? pathname === n.href
                    : pathname.startsWith(n.href),
                )?.label ?? "الإدارة"}
              </h1>
            </div>
          </div>
          <Link
            href="/chat"
            className="hidden items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground sm:flex"
          >
            المنصة
            <ArrowRight className="h-3 w-3" />
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
            aria-label="إغلاق"
          />
          <aside className="absolute right-0 top-0 flex h-full w-64 flex-col bg-[#0a0a0a] shadow-xl">
            <div className="flex items-center justify-between border-b border-white/8 p-4">
              <span className="font-bold">Admin</span>
              <button type="button" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </div>
  );
}
