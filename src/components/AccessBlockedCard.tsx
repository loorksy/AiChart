"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert, LogOut } from "lucide-react";

/**
 * The one blocked-state card, shared by /awaiting-approval and
 * /complete-profile so the two pages cannot drift apart visually.
 *
 * Client component only for the sign-out button — logout is a POST
 * (`/api/auth/logout`), so it cannot be a plain link.
 */
export function AccessBlockedCard({
  message,
  hint,
  action,
}: {
  message: string;
  hint?: string;
  action?: { label: string; href: string };
}) {
  const router = useRouter();

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-background px-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-muted/20 p-6 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-warning" aria-hidden />
        <h1 className="mt-4 text-lg font-semibold text-foreground">{message}</h1>
        {hint ? (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{hint}</p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          {action ? (
            <button
              type="button"
              onClick={() => router.push(action.href)}
              className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 focus-ring"
            >
              {action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
              router.push("/login");
            }}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-4 text-sm text-muted-foreground transition-colors hover:bg-muted focus-ring"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            تسجيل الخروج
          </button>
        </div>
      </div>
    </main>
  );
}
