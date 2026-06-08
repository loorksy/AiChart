"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export function MasterKillCard({
  initialOn,
}: {
  initialOn: boolean;
}) {
  const [masterKill, setMasterKill] = useState(initialOn);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !masterKill;
    if (next && !confirm("إيقاف كل التداول لجميع المستخدمين فوراً؟")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      const data = await res.json();
      if (res.ok) setMasterKill(data.master_kill);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "admin-card flex flex-wrap items-center justify-between gap-4 p-5",
        masterKill && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            masterKill ? "bg-destructive/20" : "bg-primary/15",
          )}
        >
          <AlertTriangle
            className={cn("h-5 w-5", masterKill ? "text-destructive" : "text-primary")}
          />
        </div>
        <div>
          <h2 className="font-bold text-foreground">Master Kill Switch</h2>
          <p className="text-sm text-muted-foreground">
            {masterKill
              ? "كل التداول موقوف على مستوى المنصة."
              : "إيقاف فوري لكل التداول عند الطوارئ."}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={cn(
          "rounded-lg px-4 py-2 text-sm font-semibold transition",
          masterKill
            ? "bg-secondary text-foreground hover:bg-muted"
            : "bg-destructive text-destructive-foreground hover:opacity-90",
        )}
      >
        {busy ? "…" : masterKill ? "إلغاء الإيقاف العام" : "إيقاف عام الآن"}
      </button>
    </div>
  );
}
