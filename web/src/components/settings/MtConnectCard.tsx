"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import type { MtAccountMeta } from "@/lib/types";
import type { MtPlatform } from "@/lib/markets/types";

export function MtConnectCard({
  account,
}: {
  account: MtAccountMeta | null;
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState<MtPlatform>(
    account?.platform ?? "mt5",
  );
  const [server, setServer] = useState(account?.server ?? "");
  const [login, setLogin] = useState(account?.login ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  async function connect() {
    if (!server.trim() || !login.trim() || !password.trim()) {
      setMsg({ type: "err", text: "أكمل الحقول الثلاثة: الحساب، كلمة المرور، السيرفر." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/mt/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, server, login, password }),
      });
      let data: { error?: string; online?: boolean } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        if (res.status === 504) {
          setMsg({
            type: "err",
            text: "انتهت مهلة الاتصال — قد يكون جسر MT5 بطيئاً أو متوقفاً. جرّب «جسر EA» من الإعدادات.",
          });
          return;
        }
      }
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "تعذّر ربط الحساب." });
        return;
      }
      setPassword("");
      setMsg({
        type: "ok",
        text: data.online
          ? "تم الربط — MetaTrader متصل وجاهز للتداول."
          : "تم الربط — جارٍ الاتصال بالوسيط (قد يستغرق دقيقة).",
      });
      router.refresh();
    } catch {
      setMsg({
        type: "err",
        text: "تعذّر الاتصال بالخادم — تحقق من الشبكة أو جرّب لاحقاً.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("إلغاء ربط MetaTrader؟ سيتوقف التنفيذ على الفوركس.")) return;
    setBusy(true);
    try {
      await fetch("/api/mt/connect", { method: "DELETE" });
      setMsg(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = account?.online
    ? "متصل"
    : account
      ? "جارٍ الاتصال…"
      : "غير مربوط";

  return (
    <SurfaceCard>
      <h2 className="mb-1 text-xl font-semibold">ربط MetaTrader (فوركس)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        ثلاثة حقول فقط — بدون تثبيت أو VPS. انسخ البيانات من تطبيق MetaTrader على
        هاتفك.
      </p>

      {account && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary px-4 py-3">
          <div className="text-sm">
            <span
              className={account.online ? "text-accent-gold" : "text-amber-500"}
            >
              ● {statusLabel}
            </span>{" "}
            — {account.platform.toUpperCase()} · {account.login}
            {account.balance > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · {account.balance.toFixed(2)}{" "}
                {account.currency ?? "USD"}
              </span>
            )}
          </div>
          <button
            onClick={() => void disconnect()}
            disabled={busy}
            className="btn btn-danger py-1.5 text-sm"
          >
            إلغاء الربط
          </button>
        </div>
      )}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <div>
          <label className="text-sm font-medium">المنصّة</label>
          <select
            className="input mt-1 w-full"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as MtPlatform)}
          >
            <option value="mt5">MetaTrader 5</option>
            <option value="mt4">MetaTrader 4</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">رقم الحساب</label>
          <input
            className="input mt-1 w-full"
            dir="ltr"
            inputMode="numeric"
            placeholder="12345678"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="text-sm font-medium">كلمة مرور التداول</label>
          <input
            className="input mt-1 w-full"
            dir="ltr"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            كلمة مرور التداول (Master) — ليس كلمة Investor للقراءة فقط.
          </p>
        </div>

        <div>
          <label className="text-sm font-medium">اسم السيرفر</label>
          <input
            className="input mt-1 w-full"
            dir="ltr"
            placeholder="ICMarketsSC-Demo"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            من MT: اضغط على حسابك ← Server — انسخ الاسم حرفياً.
          </p>
        </div>

        {msg && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              msg.type === "ok"
                ? "bg-secondary text-foreground"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {msg.text}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary w-full gap-2 sm:w-auto"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          {busy ? "جارٍ الربط…" : account ? "تحديث الربط" : "ربط الحساب"}
        </button>

        <ol className="list-decimal space-y-1 rounded-xl bg-secondary/60 p-4 ps-8 text-xs text-muted-foreground">
          <li>افتح MetaTrader على هاتفك.</li>
          <li>من «الإعدادات» أو «حسابات» انسخ رقم الحساب واسم السيرفر.</li>
          <li>أدخل كلمة مرور التداول (Master) — نفس التي تسجّل دخولك بها.</li>
          <li>اضغط «ربط الحساب» — لا حاجة لتثبيت أي شيء آخر.</li>
        </ol>
      </form>
    </SurfaceCard>
  );
}
