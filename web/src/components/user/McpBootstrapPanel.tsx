"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function McpBootstrapPanel({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked in some browser contexts; the textarea remains selectable.
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">رسالة البدء</h2>
          <p className="text-xs text-muted-foreground">
            الصقها كأول رسالة بعد ربط الـMCP
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary inline-flex shrink-0 items-center gap-1 px-3 text-xs"
          onClick={() => void copy()}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              تم النسخ
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              نسخ
            </>
          )}
        </button>
      </div>
      <textarea
        readOnly
        value={text}
        rows={14}
        dir="rtl"
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-72 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-7 text-foreground outline-none focus:border-primary/60"
      />
    </div>
  );
}
