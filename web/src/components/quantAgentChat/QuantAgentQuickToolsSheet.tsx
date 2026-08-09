"use client";

/**
 * The composer's "Quick tools" sheet — the second surface the tile grid
 * appears on, reachable once a conversation has started and the welcome grid
 * is gone.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `src/views/ai-analysis/components/CopilotWorkbench.vue:432-454`, the
 * `a-modal` the composer's `appstore` button opens. Behaviour only: upstream's
 * 760px-wide antd modal is replaced by this platform's own overlay idiom (a
 * bottom sheet on a phone, a centred dialog from `lg`), copied in SHAPE from
 * `components/agent/SymbolPickerSheet.tsx` so both overlays dismiss the same
 * way — backdrop tap, Escape, or a downward drag on the grab handle.
 *
 * It deliberately does NOT take a `SheetCoordinator` slot: those are for
 * full-bleed surfaces summoned from a different corner of the UI than the one
 * they cover. This one is opened by, and belongs to, the composer directly
 * below it, and closes the moment a tool is chosen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useSheetGesture } from "@/hooks/useSheetGesture";
import type { QuantAgentQuickTool } from "@/lib/agent/quantAgentChat/quickTools";
import { QuantAgentQuickTools } from "./QuantAgentQuickTools";

export interface QuantAgentQuickToolsSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (tool: QuantAgentQuickTool) => void;
  disabled?: boolean;
}

export function QuantAgentQuickToolsSheet({
  open,
  onClose,
  onSelect,
  disabled,
}: QuantAgentQuickToolsSheetProps) {
  const { t, dir } = useLocale();
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const { handleProps } = useSheetGesture({ sheetRef: panelRef, onDismiss: onClose });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const handleSelect = useCallback(
    (tool: QuantAgentQuickTool) => {
      onClose();
      onSelect(tool);
    },
    [onClose, onSelect],
  );

  if (!mounted || !open) return null;

  return createPortal(
    <div dir={dir} className="fixed inset-0 z-[160] flex items-end justify-center lg:items-center lg:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/55 duration-200 animate-in fade-in motion-reduce:animate-none"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("qa.quicktool.title")}
        data-testid="quant-agent-quick-tools"
        className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background text-foreground duration-250 animate-in slide-in-from-bottom-6 ease-out motion-reduce:animate-none lg:max-h-[80vh] lg:max-w-2xl lg:rounded-2xl lg:slide-in-from-bottom-0 lg:zoom-in-95"
      >
        {/* Grab handle — phones only; a desktop dialog is dismissed by its X. */}
        <div
          {...handleProps}
          className="flex shrink-0 cursor-grab justify-center pt-2 active:cursor-grabbing lg:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>

        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("qa.quicktool.title")}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t("qa.quicktool.description")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("shell.close")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <QuantAgentQuickTools onSelect={handleSelect} disabled={disabled} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
