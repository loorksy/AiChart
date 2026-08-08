"use client";

/**
 * Shared code-block renderer (language label + copy button). Originally
 * defined inline in `QuantAgentChatMessage.tsx` for fenced markdown code in
 * assistant replies; extracted here (plan §5) so
 * `QuantAgentStrategyProposalCard.tsx` can reuse it verbatim for rendering
 * sandboxed-code strategy proposals without duplicating it or creating a
 * circular import between the two components.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

export interface CodeBlockProps {
  language: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const { t, dir } = useLocale();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  }

  return (
    <div dir={dir} className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{language}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" aria-hidden="true" />
              {t("qa.chat.code.copied")}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden="true" />
              {t("qa.chat.code.copy")}
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-[12.5px] leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}
