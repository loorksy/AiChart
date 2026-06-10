"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import type { EaConnectionMeta } from "@/lib/types";
import type { MtPlatform } from "@/lib/markets/types";

export function EaConnectCard({
  connection,
}: {
  connection: EaConnectionMeta | null;
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState<MtPlatform>(
    connection?.platform ?? "mt5",
  );
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setMsg(null);
    setToken(null);
    try {
      const res = await fetch("/api/ea/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "تعذّر توليد الرمز." });
        return;
      }
      setToken(data.token as string);
      setMsg({
        type: "ok",
        text: "تم توليد الرمز. انسخه الآن — لن يُعرض مرة أخرى.",
      });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "تعذّر الاتصال بالخادم." });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm("إلغاء ربط MetaTrader؟ سيتوقف التنفيذ على الفوركس.")) return;
    setBusy(true);
    try {
      await fetch("/api/ea/token", { method: "DELETE" });
      setToken(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const statusLabel = connection?.online
    ? "متصل"
    : connection?.status === "revoked"
      ? "ملغى"
      : connection
        ? "غير متصل"
        : "غير مربوط";

  return (
    <SurfaceCard>
      <h2 className="mb-1 text-xl font-semibold">ربط MetaTrader (فوركس)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        بديل MetaApi — يعمل عبر Expert Advisor على جهازك أو VPS. مناسب حيث لا
        تتوفر الخدمات السحابية.
      </p>

      {connection && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <div className="text-sm">
            <span
              className={connection.online ? "text-accent-gold" : "text-amber-500"}
            >
              ● {statusLabel}
            </span>{" "}
            — {connection.platform.toUpperCase()}
            {connection.broker_name ? ` · ${connection.broker_name}` : ""}
          </div>
          <button
            onClick={revoke}
            disabled={busy}
            className="btn btn-danger py-1.5 text-sm"
          >
            إلغاء
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">المنصّة</label>
          <select
            className="input mt-1"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as MtPlatform)}
          >
            <option value="mt5">MetaTrader 5</option>
            <option value="mt4">MetaTrader 4</option>
          </select>
        </div>

        {token && (
          <div className="rounded-xl border border-accent-gold/40 bg-secondary p-3">
            <p className="mb-1 text-xs text-muted-foreground">
              رمز الربط (انسخه الآن):
            </p>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate rounded-lg bg-background px-2 py-1.5 text-xs"
                dir="ltr"
              >
                {token}
              </code>
              <button
                type="button"
                onClick={() => void copyToken()}
                className="btn btn-secondary shrink-0 gap-1 py-1.5 text-xs"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "نُسخ" : "نسخ"}
              </button>
            </div>
          </div>
        )}

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
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="btn btn-primary gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {busy
            ? "جارٍ…"
            : connection
              ? "توليد رمز جديد (تدوير)"
              : "توليد رمز الربط"}
        </button>

        <ol className="list-decimal space-y-1 rounded-xl bg-secondary/60 p-4 ps-8 text-xs text-muted-foreground">
          <li>
            حمّل ملف EA من المستودع: <code dir="ltr">ea/mt5/AiChartBridge.mq5</code> أو{" "}
            <code dir="ltr">ea/mt4/AiChartBridge.mq4</code>.
          </li>
          <li>ضعه في مجلد Experts ثم أعد الترجمة في MetaEditor.</li>
          <li>اسحب EA على شارت، والصق الرمز في خانة <code dir="ltr">EaToken</code>.</li>
          <li>
            MT4: أضف رابط الموقع في{" "}
            <span dir="ltr">Tools → Options → Expert Advisors → WebRequest</span>.
          </li>
          <li>فعّل AutoTrading (الزر الأخضر).</li>
        </ol>
      </div>
    </SurfaceCard>
  );
}
