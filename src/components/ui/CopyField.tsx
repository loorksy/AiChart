"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyField({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-1">
      {label ? (
        <p className="text-xs text-muted-foreground">{label}</p>
      ) : null}
      <div className="flex gap-2" dir="ltr">
        <input
          type="text"
          readOnly
          value={value}
          className="input min-w-0 flex-1 py-2 text-xs"
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          className="btn btn-secondary inline-flex shrink-0 items-center gap-1 px-3 text-xs"
          onClick={() => void copy()}
          aria-label="نسخ"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              تم
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              نسخ
            </>
          )}
        </button>
      </div>
    </div>
  );
}
