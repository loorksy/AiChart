"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plug } from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import type { PublicUser } from "@/lib/types";

export function CompleteProfileClient({ user }: { user: PublicUser }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/me/credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          password_confirm: passwordConfirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل الحفظ.");
        return;
      }
      router.push("/awaiting-approval");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <AiChartLogo size={22} showName nameClassName="text-lg font-semibold" />
      </div>
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="flex items-start gap-3">
          <Plug className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h1 className="text-xl font-bold">أكمل بيانات حسابك</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              سجّلت عبر Telegram — أدخل بريداً وكلمة مرور لإكمال حسابك وربط المساعد لاحقاً.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              className="input w-full"
              dir="ltr"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">
              كلمة المرور
            </label>
            <input
              type="password"
              className="input w-full"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">
              تأكيد كلمة المرور
            </label>
            <input
              type="password"
              className="input w-full"
              autoComplete="new-password"
              minLength={8}
              required
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              disabled={loading}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? "جاري الحفظ…" : "حفظ والمتابعة"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          بعد الحفظ → انتظار موافقة الإدارة.{" "}
          <Link href="/login" className="text-link">
            تسجيل الخروج
          </Link>
        </p>
        {user.telegram_id ? (
          <p className="text-center text-xs text-muted-foreground">
            Telegram مرتبط · @{user.username ?? user.telegram_id}
          </p>
        ) : null}
      </div>
    </div>
  );
}
