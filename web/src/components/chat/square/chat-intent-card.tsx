"use client";

import { cn } from "@/lib/utils";
import { MessageLoading } from "@/components/ui/message-loading";
import type { ProcessedIntent } from "@/lib/tradeFlow";

const STATUS_AR: Record<string, string> = {
  pending: "بانتظار موافقتك",
  approved: "موافق",
  rejected: "مرفوض",
  executed: "نُفّذت",
  failed: "فشل",
};

export function ChatIntentCard({
  intent,
  busy,
  onApprove,
  onReject,
}: {
  intent: ProcessedIntent;
  busy?: boolean;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
}) {
  const pending = intent.status === "pending";

  return (
    <div className="mt-3 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold" dir="ltr">
          {intent.symbol}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            intent.side === "buy"
              ? "bg-sidebar-accent text-primary"
              : "bg-destructive/15 text-destructive",
          )}
        >
          {intent.side === "buy" ? "شراء" : "بيع"}
        </span>
      </div>
      <p className="text-muted-foreground">
        الحجم: <span dir="ltr">{intent.notional.toFixed(2)} USDT</span>
      </p>
      {intent.order_type === "limit" &&
        (intent.limit_price ?? intent.entry) != null &&
        (intent.limit_price ?? intent.entry)! > 0 && (
          <p className="mt-1 text-amber-600 dark:text-amber-400">
            تنفيذ كأمر معلّق @{" "}
            <span dir="ltr">
              {(intent.limit_price ?? intent.entry)!.toLocaleString(undefined, {
                maximumFractionDigits: 5,
              })}
            </span>
          </p>
        )}
      {!pending && (
        <p className="mt-1 font-medium text-foreground">
          {STATUS_AR[intent.status] ?? intent.status}
          {intent.reason ? ` — ${intent.reason}` : ""}
        </p>
      )}
      {pending && onApprove && onReject && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="btn btn-primary flex-1 py-1.5 text-sm"
            disabled={busy}
            onClick={() => onApprove(intent.id)}
          >
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <MessageLoading />
              </span>
            ) : (
              intent.order_type === "limit" ? "موافقة — أمر معلّق" : "موافقة وتنفيذ"
            )}
          </button>
          <button
            type="button"
            className="btn btn-danger flex-1 py-1.5 text-sm"
            disabled={busy}
            onClick={() => onReject(intent.id)}
          >
            رفض
          </button>
        </div>
      )}
    </div>
  );
}
