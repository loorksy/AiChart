"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import { useLocale } from "@/hooks/useLocale";
import type { EaConnectionMeta } from "@/lib/types";
import type { MtPlatform } from "@/lib/markets/types";
import { Download } from "lucide-react";

export function EaConnectCard({
  connection,
  canDownloadEa = false,
}: {
  connection: EaConnectionMeta | null;
  canDownloadEa?: boolean;
}) {
  const router = useRouter();
  const { locale, dir } = useLocale();
  const isRtl = locale === "ar";
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
        setMsg({
          type: "err",
          text: data.error ?? (isRtl ? "تعذّر توليد الرمز." : "Could not generate the token."),
        });
        return;
      }
      setToken(data.token as string);
      setMsg({
        type: "ok",
        text: isRtl
          ? "تم توليد الرمز. انسخه الآن — لن يُعرض مرة أخرى."
          : "Token generated. Copy it now — it will not be shown again.",
      });
      router.refresh();
    } catch {
      setMsg({
        type: "err",
        text: isRtl ? "تعذّر الاتصال بالخادم." : "Could not connect to the server.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (
      !confirm(
        isRtl
          ? "إلغاء ربط MetaTrader؟ سيتوقف التنفيذ على الفوركس."
          : "Disconnect MetaTrader? Forex execution will stop.",
      )
    ) return;
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
    ? (isRtl ? "متصل" : "Connected")
    : connection?.status === "revoked"
      ? (isRtl ? "ملغى" : "Revoked")
      : connection
        ? (isRtl ? "غير متصل" : "Offline")
        : (isRtl ? "غير مربوط" : "Not connected");

  return (
    <div dir={dir}>
      <SurfaceCard className="space-y-4">
        <div>
          <h2 className="mb-1 text-xl font-semibold">
            {isRtl ? "ربط MetaTrader (فوركس)" : "Connect MetaTrader (Forex)"}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {isRtl
              ? "اربط MetaTrader 5 عبر Expert Advisor على جهازك أو VPS — التنفيذ والأسعار مباشرة من منصتك."
              : "Connect MetaTrader 5 through an Expert Advisor on your computer or VPS — execution and prices come directly from your terminal."}
          </p>
        </div>

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
            className="btn btn-danger min-h-11 text-sm"
          >
            {isRtl ? "إلغاء" : "Disconnect"}
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="ea-platform" className="text-sm font-medium">
            {isRtl ? "المنصّة" : "Platform"}
          </label>
          <select
            id="ea-platform"
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
              {isRtl ? "رمز الربط (انسخه الآن):" : "Connection token (copy it now):"}
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
                className="btn btn-secondary min-h-11 shrink-0 gap-1 text-xs"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied
                  ? (isRtl ? "نُسخ" : "Copied")
                  : (isRtl ? "نسخ" : "Copy")}
              </button>
            </div>
          </div>
        )}

        {msg && (
          <p
            role={msg.type === "err" ? "alert" : "status"}
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
          className="btn btn-primary min-h-11 gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {busy
            ? (isRtl ? "جارٍ…" : "Working…")
            : connection
              ? (isRtl ? "توليد رمز جديد (تدوير)" : "Generate a new token (rotate)")
              : (isRtl ? "توليد رمز الربط" : "Generate connection token")}
        </button>

        {canDownloadEa ? (
          <a
            href="/api/ea/download"
            className="btn btn-secondary inline-flex min-h-11 gap-2"
            download="AiChartBridge.ex5"
          >
            <Download className="h-4 w-4" />
            {isRtl ? "تحميل AiChartBridge.ex5" : "Download AiChartBridge.ex5"}
          </a>
        ) : (
          <p className="rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            {isRtl
              ? "تحميل ملف EA يتاح بعد موافقة الإدارة على حسابك."
              : "The EA download becomes available after an administrator approves your account."}
          </p>
        )}

        <ol className="list-decimal space-y-1 rounded-xl bg-secondary/60 p-4 ps-8 text-xs text-muted-foreground">
          <li>
            {canDownloadEa
              ? (isRtl
                  ? "حمّل AiChartBridge.ex5 بالزر أعلاه، أو من المستودع:"
                  : "Download AiChartBridge.ex5 above, or get it from the repository:")
              : (isRtl
                  ? "بعد الموافقة: حمّل AiChartBridge.ex5 من الزر أعلاه، أو من المستودع:"
                  : "After approval, download AiChartBridge.ex5 above or from the repository:")}{" "}
            <code dir="ltr">ea/mt5/AiChartBridge.mq5</code>
            {canDownloadEa ? "" : (isRtl ? " (مصدر)" : " (source)")}
            .
          </li>
          <li>
            {isRtl
              ? "ضعه في مجلد Experts ثم أعد الترجمة في MetaEditor."
              : "Place it in the Experts folder, then compile it in MetaEditor."}
          </li>
          <li>
            {isRtl ? "اسحب EA على شارت، والصق الرمز في خانة " : "Attach the EA to a chart and paste the token into "}
            <code dir="ltr">EaToken</code>.
          </li>
          <li>
            {isRtl ? "MT4: أضف رابط الموقع في " : "MT4: add the site URL under "}
            <span dir="ltr">Tools → Options → Expert Advisors → WebRequest</span>.
          </li>
          <li>
            {isRtl ? "فعّل AutoTrading (الزر الأخضر)." : "Enable AutoTrading (the green button)."}
          </li>
        </ol>
      </div>
      </SurfaceCard>
    </div>
  );
}
