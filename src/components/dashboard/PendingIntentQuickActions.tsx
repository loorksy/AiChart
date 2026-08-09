"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SurfaceCard } from "@/components/ui/shell";
import type { TradeIntent } from "@/lib/types";
import { consumeSse } from "@/lib/sse";

export function PendingIntentQuickActions({
  intents,
  onChange,
}: {
  intents: TradeIntent[];
  onChange?: (pending: TradeIntent[]) => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function act(id: number, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/trades/intents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, stream: action === "approve" }),
      });

      if (action === "approve" && res.ok) {
        await consumeSse(res, {});
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(
          (data as { reason?: string; error?: string }).reason ??
            (data as { error?: string }).error ??
            "تعذّر تنفيذ الإجراء.",
        );
      }

      const refreshed = await fetch("/api/trades").then((r) => r.json());
      const pending = (refreshed.intents ?? []).filter(
        (i: TradeIntent) => i.status === "pending",
      );
      onChange?.(pending);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SurfaceCard className="space-y-3">
      <h3 className="font-semibold">صفقات بانتظار موافقتك</h3>
      <ul className="space-y-2">
        {intents.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-secondary/20 p-3"
          >
            <div>
              <p className="font-medium" dir="ltr">
                {i.side === "buy" ? "شراء" : "بيع"} {i.symbol}
              </p>
              <p className="text-xs text-muted-foreground">
                ${i.notional.toFixed(0)} · ثقة {i.confidence}%
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId === i.id}
                onClick={() => void act(i.id, "approve")}
                className="btn btn-primary text-xs"
              >
                موافقة
              </button>
              <button
                type="button"
                disabled={busyId === i.id}
                onClick={() => void act(i.id, "reject")}
                className="btn btn-secondary text-xs"
              >
                رفض
              </button>
            </div>
          </li>
        ))}
      </ul>
    </SurfaceCard>
  );
}
