"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { LonoraLogo } from "@/components/LonoraLogo";
import { USER_NAV } from "@/components/user/userNav";
import { displayNameForUser } from "@/lib/displayName";
import type { PublicUser } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function UserShell({
  user,
  children,
}: {
  user: PublicUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const name = displayNameForUser(user);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        لوحة المستخدم
      </p>
      {USER_NAV.map((item) => {
        const active =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition",
              active
                ? "bg-primary/15 font-semibold text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
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
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <aside className="hidden w-56 shrink-0 border-l border-border bg-sidebar lg:block">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <LonoraLogo size={20} showName nameClassName="font-bold" />
        </div>
        {nav}
        <div className="mt-auto border-t border-border p-3">
          <p className="truncate px-3 text-xs text-muted-foreground">{name}</p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4" />
            خروج
          </button>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 lg:hidden">
          <span className="font-semibold">{name}</span>
          <button type="button" onClick={() => setOpen(true)} aria-label="القائمة">
            <Menu className="h-6 w-6" />
          </button>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 bg-background/95 lg:hidden">
            <div className="flex justify-end p-4">
              <button type="button" onClick={() => setOpen(false)}>
                <X className="h-6 w-6" />
              </button>
            </div>
            {nav}
          </div>
        )}
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
