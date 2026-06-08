"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminLimits,
  BinanceAccountMeta,
  TradingSettings,
} from "@/lib/types";

export default function SettingsClient({
  settings: initialSettings,
  limits,
  binance,
}: {
  settings: TradingSettings;
  limits: AdminLimits;
  binance: BinanceAccountMeta | null;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold">الإعدادات</h1>
      <div className="space-y-6">
        <BinanceCard binance={binance} />
        <TradingCard settings={initialSettings} limits={limits} />
      </div>
    </main>
  );
}

function BinanceCard({ binance }: { binance: BinanceAccountMeta | null }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [env, setEnv] = useState<"testnet" | "prod">(
    (binance?.env as "testnet" | "prod") ?? "testnet",
  );
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/binance/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, env }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل الربط." });
        return;
      }
      setApiKey("");
      setApiSecret("");
      setMsg({
        type: "ok",
        text: data.withdrawWarning
          ? `تم الربط بنجاح. ${data.withdrawWarning}`
          : "تم الربط والتحقق بنجاح.",
      });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "تعذّر الاتصال بالخادم." });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("هل تريد فصل حساب Binance؟")) return;
    await fetch("/api/binance", { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="card p-6">
      <h2 className="mb-1 text-lg font-bold">ربط Binance</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        فعّل صلاحية <b>التداول</b> فقط، وعطّل <b>السحب</b>، ويُفضّل تقييد المفتاح
        بعنوان IP الخادم.
      </p>

      {binance && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-4 py-3">
          <div className="text-sm">
            <span className="text-[var(--accent)]">● مرتبط</span> — البيئة:{" "}
            {binance.env === "testnet" ? "تجريبية (Testnet)" : "حقيقية"}
          </div>
          <button onClick={disconnect} className="btn btn-danger py-1.5 text-sm">
            فصل
          </button>
        </div>
      )}

      <form onSubmit={connect} className="space-y-4">
        <div>
          <label htmlFor="env">البيئة</label>
          <select
            id="env"
            className="input mt-1"
            value={env}
            onChange={(e) => setEnv(e.target.value as "testnet" | "prod")}
          >
            <option value="testnet">تجريبية (Testnet) — موصى به</option>
            <option value="prod">حقيقية (Mainnet)</option>
          </select>
        </div>
        <div>
          <label htmlFor="apiKey">API Key</label>
          <input
            id="apiKey"
            className="input mt-1"
            dir="ltr"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="مفتاح API"
          />
        </div>
        <div>
          <label htmlFor="apiSecret">API Secret</label>
          <input
            id="apiSecret"
            type="password"
            className="input mt-1"
            dir="ltr"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="السر"
          />
        </div>

        {msg && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              msg.type === "ok"
                ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                : "bg-[var(--danger)]/10 text-[var(--danger)]"
            }`}
          >
            {msg.text}
          </p>
        )}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? "جارٍ التحقق…" : binance ? "تحديث المفاتيح" : "ربط وتحقق"}
        </button>
      </form>
    </section>
  );
}

function TradingCard({
  settings,
  limits,
}: {
  settings: TradingSettings;
  limits: AdminLimits;
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [assets, setAssets] = useState(
    (JSON.parse(settings.allowed_assets) as string[]).join(", "),
  );
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  function set<K extends keyof TradingSettings>(k: K, v: TradingSettings[K]) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: s.mode,
          approval: s.approval,
          experience: s.experience,
          style: s.style,
          max_capital: Number(s.max_capital),
          per_trade_pct: Number(s.per_trade_pct),
          max_open_trades: Number(s.max_open_trades),
          daily_profit_target_pct: Number(s.daily_profit_target_pct),
          daily_loss_limit_pct: Number(s.daily_loss_limit_pct),
          monthly_loss_limit_pct: Number(s.monthly_loss_limit_pct),
          allowed_assets: assets
            .split(",")
            .map((a) => a.trim().toUpperCase())
            .filter(Boolean),
          send_screenshot: Boolean(s.send_screenshot),
          telegram_chat_id: s.telegram_chat_id || null,
          kill_switch: Boolean(s.kill_switch),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل الحفظ." });
        return;
      }
      setMsg({
        type: "ok",
        text: data.capped ?? "تم حفظ الإعدادات.",
      });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "تعذّر الاتصال بالخادم." });
    } finally {
      setBusy(false);
    }
  }

  const Field = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div>
      <label>{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );

  return (
    <section className="card p-6">
      <h2 className="mb-1 text-lg font-bold">إعدادات التداول والمخاطر</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        هذه الحدود تُفرض برمجياً قبل أي صفقة. سقوف الإدارة لا يمكن تجاوزها.
      </p>

      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="الوضع">
          <select
            className="input"
            value={s.mode}
            onChange={(e) => set("mode", e.target.value as TradingSettings["mode"])}
          >
            <option value="advisory">توصيات فقط</option>
            <option value="auto" disabled={!limits.can_execute}>
              تنفيذ تلقائي {limits.can_execute ? "" : "(يتطلب موافقة الإدارة)"}
            </option>
          </select>
        </Field>

        <Field label="نمط الموافقة">
          <select
            className="input"
            value={s.approval}
            onChange={(e) =>
              set("approval", e.target.value as TradingSettings["approval"])
            }
          >
            <option value="manual">تأكيد يدوي لكل صفقة</option>
            <option value="delegate">تفويض تلقائي ضمن الحدود</option>
          </select>
        </Field>

        <Field label="مستوى الخبرة">
          <select
            className="input"
            value={s.experience}
            onChange={(e) =>
              set("experience", e.target.value as TradingSettings["experience"])
            }
          >
            <option value="beginner">مبتدئ (الوكيل يقترح الإعدادات)</option>
            <option value="expert">خبير (أضبط الإعدادات بنفسي)</option>
          </select>
        </Field>

        <Field label="أسلوب التداول">
          <select
            className="input"
            value={s.style}
            onChange={(e) => set("style", e.target.value as TradingSettings["style"])}
          >
            <option value="conservative">محافظ</option>
            <option value="balanced">متوازن</option>
            <option value="aggressive">نشِط</option>
          </select>
        </Field>

        <Field
          label={`سقف رأس المال (USDT)${limits.max_capital_cap ? ` — الحد الأقصى ${limits.max_capital_cap}` : ""}`}
        >
          <input
            type="number"
            min={0}
            className="input"
            value={s.max_capital}
            onChange={(e) => set("max_capital", Number(e.target.value))}
          />
        </Field>

        <Field label="حجم الصفقة (% من رأس المال)">
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            className="input"
            value={s.per_trade_pct}
            onChange={(e) => set("per_trade_pct", Number(e.target.value))}
          />
        </Field>

        <Field
          label={`أقصى صفقات مفتوحة (الحد الأقصى ${limits.max_open_trades_cap})`}
        >
          <input
            type="number"
            min={1}
            max={limits.max_open_trades_cap}
            className="input"
            value={s.max_open_trades}
            onChange={(e) => set("max_open_trades", Number(e.target.value))}
          />
        </Field>

        <Field label="هدف الربح اليومي %">
          <input
            type="number"
            min={0}
            step={0.1}
            className="input"
            value={s.daily_profit_target_pct}
            onChange={(e) =>
              set("daily_profit_target_pct", Number(e.target.value))
            }
          />
        </Field>

        <Field label="حد الخسارة اليومي %">
          <input
            type="number"
            min={0}
            step={0.1}
            className="input"
            value={s.daily_loss_limit_pct}
            onChange={(e) => set("daily_loss_limit_pct", Number(e.target.value))}
          />
        </Field>

        <Field label="حد الخسارة الشهري %">
          <input
            type="number"
            min={0}
            step={0.1}
            className="input"
            value={s.monthly_loss_limit_pct}
            onChange={(e) =>
              set("monthly_loss_limit_pct", Number(e.target.value))
            }
          />
        </Field>

        <Field label="الأصول المسموحة (مفصولة بفاصلة)">
          <input
            className="input"
            dir="ltr"
            value={assets}
            onChange={(e) => setAssets(e.target.value)}
            placeholder="BTCUSDT, ETHUSDT"
          />
        </Field>

        <Field label="معرّف تليجرام (Chat ID)">
          <input
            className="input"
            dir="ltr"
            value={s.telegram_chat_id ?? ""}
            onChange={(e) => set("telegram_chat_id", e.target.value)}
            placeholder="اختياري"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
          <input
            type="checkbox"
            checked={Boolean(s.send_screenshot)}
            onChange={(e) => set("send_screenshot", e.target.checked ? 1 : 0)}
          />
          إرسال سكرين شوت لكل صفقة
        </label>

        <label className="flex items-center gap-2 text-sm text-[var(--danger)]">
          <input
            type="checkbox"
            checked={Boolean(s.kill_switch)}
            onChange={(e) => set("kill_switch", e.target.checked ? 1 : 0)}
          />
          الإيقاف الطارئ (إيقاف كل التداول)
        </label>

        <div className="sm:col-span-2">
          {msg && (
            <p
              className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                msg.type === "ok"
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "bg-[var(--danger)]/10 text-[var(--danger)]"
              }`}
            >
              {msg.text}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
          </button>
        </div>
      </form>
    </section>
  );
}
