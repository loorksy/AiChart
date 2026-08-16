"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, UserRoundPlus } from "lucide-react";

/**
 * The credential form /complete-profile hosts ITSELF.
 *
 * It cannot link to settings instead: every console layout bounces a user
 * with incomplete credentials back to /complete-profile, so a "finish your
 * profile in settings" button is a redirect loop. The page is the one place
 * such a user can reach, so the form lives here and PATCHes
 * /api/me/credentials — the route whose entire guard is this exact state.
 */
export function CompleteProfileForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/me/credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, password_confirm: confirm }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "تعذّر حفظ البيانات. حاول مرة أخرى.");
        return;
      }
      router.push("/chat");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <main
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-background px-4"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-border/60 bg-muted/20 p-6"
      >
        <UserRoundPlus className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h1 className="mt-4 text-center text-lg font-semibold text-foreground">
          أكمل ملفك الشخصي للمتابعة
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
          حسابك يحتاج بريداً إلكترونياً وكلمة مرور حتى تعمل المنصة وموصل MCP
          باسمك.
        </p>

        <label className="mt-5 block text-sm text-muted-foreground">
          البريد الإلكتروني
          <input
            type="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-ring"
          />
        </label>
        <label className="mt-3 block text-sm text-muted-foreground">
          كلمة المرور (8 أحرف على الأقل)
          <input
            type="password"
            dir="ltr"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-ring"
          />
        </label>
        <label className="mt-3 block text-sm text-muted-foreground">
          تأكيد كلمة المرور
          <input
            type="password"
            dir="ltr"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-ring"
          />
        </label>

        {error ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="mt-5 min-h-11 w-full rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50 focus-ring"
        >
          {saving ? "جارٍ الحفظ…" : "حفظ ومتابعة"}
        </button>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            router.push("/login");
          }}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-4 text-sm text-muted-foreground transition-colors hover:bg-muted focus-ring"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          تسجيل الخروج
        </button>
      </form>
    </main>
  );
}
