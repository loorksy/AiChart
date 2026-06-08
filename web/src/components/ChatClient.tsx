"use client";

import { useEffect, useRef, useState } from "react";
import type { Recommendation } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  recommendations?: Recommendation[];
}

const SUGGESTIONS = [
  "ما رأيك في BTCUSDT الآن؟",
  "حلّل ETHUSDT على إطار الساعة",
  "هل توجد فرصة جيدة اليوم؟",
];

export default function ChatClient({
  agentReady,
}: {
  agentReady: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "أهلاً، أنا الخبير 👋. اسألني عن أي عملة مسموح بها وسأحلّلها فنياً وأعطيك رأيي بصراحة — وقد يكون الرأي «الانتظار» إن لم تكن الفرصة مناسبة.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "حدث خطأ.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          recommendations: data.recommendations,
        },
      ]);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-64px)] w-full max-w-3xl flex-1 flex-col px-4 py-4">
      {!agentReady && (
        <div className="card mb-3 border-[var(--warning)]/40 p-3 text-sm text-[var(--warning)]">
          وكيل Claude غير مُفعّل بعد على الخادم (ينقص ANTHROPIC_API_KEY). الواجهة
          جاهزة وستعمل فور إضافة المفتاح.
        </div>
      )}

      <div className="card flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-left" : "text-right"}>
            <div
              className={`inline-block max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-[var(--accent-2)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--foreground)]"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
            {m.recommendations?.map((r) => (
              <RecCard key={r.id} rec={r} />
            ))}
          </div>
        ))}
        {busy && (
          <div className="text-right">
            <div className="inline-block rounded-2xl bg-[var(--surface-2)] px-4 py-2.5 text-sm text-[var(--muted)]">
              الخبير يحلّل السوق…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {messages.length <= 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="btn btn-secondary py-1.5 text-xs"
              disabled={busy}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          className="input flex-1"
          placeholder="اكتب سؤالك للخبير…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>
          إرسال
        </button>
      </form>
    </div>
  );
}

function RecCard({ rec }: { rec: Recommendation }) {
  const color =
    rec.action === "buy"
      ? "var(--accent)"
      : rec.action === "sell"
        ? "var(--danger)"
        : "var(--warning)";
  const label =
    rec.action === "buy" ? "شراء" : rec.action === "sell" ? "بيع" : "انتظار";

  return (
    <div className="mt-2 inline-block w-full max-w-[85%] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-right text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold" dir="ltr">
          {rec.symbol}
        </span>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-bold"
          style={{ background: `${color}22`, color }}
        >
          {label} · ثقة {rec.confidence}%
        </span>
      </div>
      {rec.action !== "wait" && (
        <div className="grid grid-cols-3 gap-2 text-center text-xs" dir="ltr">
          <Cell label="دخول" value={rec.entry} />
          <Cell label="وقف" value={rec.stop_loss} color="var(--danger)" />
          <Cell label="هدف" value={rec.take_profit} color="var(--accent)" />
        </div>
      )}
      {rec.rationale && (
        <p className="mt-2 text-xs text-[var(--muted)]">{rec.rationale}</p>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--surface-2)] py-1.5">
      <p className="text-[var(--muted)]">{label}</p>
      <p className="font-mono font-semibold" style={color ? { color } : undefined}>
        {value ?? "—"}
      </p>
    </div>
  );
}
