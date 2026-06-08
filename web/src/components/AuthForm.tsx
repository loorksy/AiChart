"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "حدث خطأ.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="card w-full max-w-md p-8">
        <Link href="/" className="mb-6 block text-center text-2xl font-extrabold">
          Ai<span className="text-[var(--accent)]">Chart</span>
        </Link>
        <h1 className="mb-6 text-center text-xl font-bold">
          {isLogin ? "تسجيل الدخول" : "إنشاء حساب جديد"}
        </h1>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="email">البريد الإلكتروني</label>
            <input
              id="email"
              type="email"
              required
              className="input mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="password">كلمة المرور</label>
            <input
              id="password"
              type="password"
              required
              minLength={isLogin ? 1 : 8}
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? "جارٍ المعالجة…" : isLogin ? "دخول" : "تسجيل"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          {isLogin ? "ليس لديك حساب؟ " : "لديك حساب بالفعل؟ "}
          <Link
            href={isLogin ? "/register" : "/login"}
            className="text-[var(--accent-2)]"
          >
            {isLogin ? "أنشئ حساباً" : "سجّل الدخول"}
          </Link>
        </p>

        {!isLogin && (
          <p className="mt-4 text-center text-xs text-[var(--muted)]">
            بعد التسجيل، يحتاج حسابك لموافقة الإدارة قبل تفعيل التداول.
          </p>
        )}
      </div>
    </main>
  );
}
