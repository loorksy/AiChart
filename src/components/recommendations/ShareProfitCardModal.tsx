/**
 * Bottom sheet (phone) / centred dialog (desktop) that shows the profit card
 * immediately and captures a PNG in the background for download / Web Share.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@base-ui/react/dialog";
import { Download, Share2, X } from "lucide-react";
import { useSheetGesture } from "@/hooks/useSheetGesture";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import {
  buildProfitCardModel,
  canShareFiles,
  type ProfitCardSource,
} from "@/lib/recommendations/profitCard";
import { ProfitCard } from "@/components/recommendations/ProfitCard";
import { SkeletonBlock } from "@/components/ui/skeleton";

async function capturePng(node: HTMLElement): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
  const blob = await toBlob(node, {
    pixelRatio: 2,
    cacheBust: false,
    backgroundColor: "#0c0a07",
    style: { opacity: "1", transform: "none" },
  });
  if (!blob) throw new Error("capture returned empty");
  return blob;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

export function ShareProfitCardModal({
  open,
  onClose,
  rec,
  livePrice,
  displayName,
}: {
  open: boolean;
  onClose: () => void;
  rec: ProfitCardSource;
  livePrice?: number | null;
  displayName?: string | null;
}) {
  const { t, locale, dir } = useLocale();
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const model = useMemo(
    () => buildProfitCardModel(rec, { locale, livePrice, now: Date.now() }),
    [rec, locale, livePrice],
  );

  const labels = useMemo(
    () => ({
      badge: t("profit_card.badge"),
      pnlKind:
        model.kind === "realized" ? t("profit_card.realized") : t("profit_card.unrealized"),
      side: model.side === "short" ? t("profit_card.short") : t("profit_card.long"),
      mark:
        model.markKind === "hit"
          ? t("profit_card.hit_price")
          : model.markKind === "current"
            ? t("rec.row.current_price")
            : t("profit_card.last_price"),
      entry: t("rec.row.entry"),
      date: t("profit_card.date"),
      tagline: t("profit_card.tagline"),
    }),
    [t, model.kind, model.side, model.markKind],
  );

  const { handleProps, surfaceProps } = useSheetGesture({
    sheetRef,
    scrollRef,
    onDismiss: onClose,
    enabledQuery: "(max-width: 767px)",
  });

  useEffect(() => {
    if (!open) {
      blobRef.current = null;
      setSlow(false);
      setFailed(false);
      setCopied(false);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      if (!cancelled && !blobRef.current) setSlow(true);
    }, 280);

    let tries = 0;
    const run = async () => {
      const node = captureRef.current;
      if (!node) {
        if (tries++ < 30 && !cancelled) requestAnimationFrame(() => void run());
        else if (!cancelled) setFailed(true);
        return;
      }
      const imgs = node.querySelectorAll("img");
      await Promise.all(
        [...imgs].map((img) => {
          if (img.complete) return Promise.resolve();
          return img.decode().catch(() => undefined);
        }),
      );
      // Two frames: layout + paint of the offscreen card before snapshot.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      try {
        const blob = await capturePng(node);
        if (cancelled) return;
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setSlow(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
    };
  }, [open, model.filename, model.pnlPct, model.markPrice, model.kind, displayName, locale]);

  const waitForBlob = useCallback(async (): Promise<Blob | null> => {
    if (blobRef.current) return blobRef.current;
    const node = captureRef.current;
    if (!node) return null;
    try {
      const blob = await capturePng(node);
      blobRef.current = blob;
      return blob;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  const onDownload = useCallback(async () => {
    const blob = await waitForBlob();
    if (!blob) return;
    downloadBlob(blob, model.filename);
  }, [waitForBlob, model.filename]);

  const onShare = useCallback(async () => {
    const blob = await waitForBlob();
    if (blob && canShareFiles()) {
      try {
        const file = new File([blob], model.filename, { type: "image/png" });
        await navigator.share({
          files: [file],
          title: t("profit_card.share_title"),
          text: model.shareUrl,
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(model.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      await onDownload();
    }
  }, [waitForBlob, model.filename, model.shareUrl, t, onDownload]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[130] bg-black/65 touch-none transition-opacity duration-250 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          ref={sheetRef}
          dir={dir}
          data-testid="profit-card-share-modal"
          className={cn(
            "fixed z-[131] flex w-full flex-col overflow-hidden bg-background text-foreground shadow-2xl",
            "left-0 right-0 top-auto bottom-0 max-h-[92vh] rounded-t-2xl border-x border-t border-border",
            "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            "max-md:will-change-transform",
            "max-md:transition-transform max-md:duration-300 max-md:ease-[cubic-bezier(0.32,0.72,0,1)]",
            "max-md:data-starting-style:translate-y-full max-md:data-ending-style:translate-y-full",
            "md:left-1/2 md:right-auto md:bottom-auto md:top-[8vh] md:max-h-[88vh]",
            "md:w-[min(100%-2rem,26rem)] md:-translate-x-1/2 md:rounded-2xl md:border md:pb-0",
            "md:transition-opacity md:duration-250 md:data-ending-style:opacity-0 md:data-starting-style:opacity-0",
            "motion-reduce:transition-none",
          )}
        >
          <div
            {...handleProps}
            data-testid="profit-card-share-handle"
            className="flex cursor-grab justify-center pt-3 pb-2 md:hidden active:cursor-grabbing"
            aria-hidden
          >
            <span className="h-1.5 w-12 rounded-full bg-muted-foreground/50" />
          </div>
          <header
            onPointerDown={handleProps.onPointerDown}
            onPointerMove={handleProps.onPointerMove}
            onPointerUp={handleProps.onPointerUp}
            onPointerCancel={handleProps.onPointerCancel}
            className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3 max-md:touch-none"
          >
            <Dialog.Title className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
              {t("profit_card.share_title")}
            </Dialog.Title>
            <Dialog.Close
              className="sr-only md:hidden"
              aria-label={t("agent.signal.close_report")}
            >
              {t("agent.signal.close_report")}
            </Dialog.Close>
            <Dialog.Close
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring md:inline-flex"
              aria-label={t("agent.signal.close_report")}
              data-testid="profit-card-share-close"
            >
              <X className="h-4 w-4" aria-hidden />
            </Dialog.Close>
          </header>

          <div
            ref={scrollRef}
            {...surfaceProps}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          >
            <div className="relative mx-auto w-full max-w-[360px]">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob PNG preview
                <img
                  src={previewUrl}
                  alt={t("profit_card.share_title")}
                  className="block w-full rounded-[28px] shadow-lg"
                  data-testid="profit-card-preview-image"
                />
              ) : (
                <div data-testid="profit-card-live-preview">
                  <ProfitCard model={model} displayName={displayName} labels={labels} />
                </div>
              )}
              {slow && !previewUrl ? (
                <div
                  className="absolute inset-0 flex items-center justify-center rounded-[28px] bg-background/40"
                  data-testid="profit-card-skeleton"
                >
                  <SkeletonBlock className="h-24 w-2/3" />
                </div>
              ) : null}
            </div>
            {failed ? (
              <p className="mt-3 text-center text-[12px] text-muted-foreground">
                {t("profit_card.failed")}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 border-t border-border/50 px-4 py-3">
            <button
              type="button"
              onClick={() => void onDownload()}
              data-testid="profit-card-download"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground focus-ring sm:min-h-10"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t("profit_card.download")}
            </button>
            <button
              type="button"
              onClick={() => void onShare()}
              data-testid="profit-card-share"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-foreground focus-ring sm:min-h-10"
            >
              <Share2 className="h-4 w-4" aria-hidden />
              {copied ? t("profit_card.link_copied") : t("profit_card.share")}
            </button>
          </div>

          {open && typeof document !== "undefined"
            ? createPortal(
                <div
                  aria-hidden
                  data-testid="profit-card-capture"
                  ref={captureRef}
                  className="pointer-events-none fixed"
                  style={{ left: -480, top: 0, width: 360, zIndex: -1 }}
                >
                  <ProfitCard model={model} displayName={displayName} labels={labels} />
                </div>,
                document.body,
              )
            : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
