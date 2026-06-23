"use client";

import { Cloud, Laptop, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lets the user choose HOW their forex account connects:
 *  - "platform": server-side (no download, runs 24/7 on our servers)
 *  - "ea": the EA bridge installed on the user's own MT5 terminal
 * Both remain fully supported; this only routes the user's own execution/data.
 */
export function ForexMethodSelector({
  method,
  platformAvailable,
  saving,
  onChoose,
}: {
  method: "platform" | "ea";
  platformAvailable: boolean;
  saving: boolean;
  onChoose: (method: "platform" | "ea") => void;
}) {
  return (
    <div dir="rtl" className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            طريقة ربط حساب الفوركس (MetaTrader)
          </h3>
          <p className="text-xs text-muted-foreground">
            اختر كيف يتصل حسابك — كلاهما مدعوم بالكامل.
          </p>
        </div>
        {saving && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={saving || !platformAvailable}
          onClick={() => onChoose("platform")}
          aria-pressed={method === "platform"}
          className={cn(
            "flex flex-col items-start gap-1 rounded-xl border p-3 text-right transition",
            method === "platform"
              ? "border-primary bg-primary/10"
              : "border-border bg-background/60 hover:bg-muted/50",
            (!platformAvailable || saving) && "cursor-not-allowed opacity-60",
          )}
        >
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              عبر المنصة (بدون تنزيل)
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            تنفيذ سيرفر-سايد 24/7. تكتب بيانات حسابك فقط — لا تثبيت ولا إبقاء
            جهازك مفتوحاً.
          </span>
          {!platformAvailable && (
            <span className="mt-1 text-[11px] font-medium text-amber-500">
              غير مفعّل حالياً من الإدارة.
            </span>
          )}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChoose("ea")}
          aria-pressed={method === "ea"}
          className={cn(
            "flex flex-col items-start gap-1 rounded-xl border p-3 text-right transition",
            method === "ea"
              ? "border-primary bg-primary/10"
              : "border-border bg-background/60 hover:bg-muted/50",
            saving && "cursor-not-allowed opacity-60",
          )}
        >
          <div className="flex items-center gap-2">
            <Laptop className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              عبر جسر EA (على جهازك)
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            تُثبّت الجسر على MetaTrader لديك وتُبقي جهازك يعمل. تحكّم كامل لديك.
          </span>
        </button>
      </div>
    </div>
  );
}
