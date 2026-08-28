/**
 * Bottom sheet (phone) / centred dialog (desktop) that shows the live React
 * profit card immediately. PNG capture runs in the background for download /
 * Web Share only — the visible card is never swapped for a snapshot.
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
  profitCardLabels,
  type ProfitCardSource,
} from "@/lib/recommendations/profitCard";
import {
  captureProfitCardPng,
  isUsablePngBlob,
  loadProfitCardLogoDataUrl,
  PROFIT_CARD_CAPTURE_MIN_HEIGHT,
  PROFIT_CARD_CAPTURE_WIDTH,
} from "@/lib/recommendations/profitCardCapture";
import { ProfitCard } from "@/components/recommendations/ProfitCard";

function downloadBlob(blob: Blob, filename: string, retainUrl: (url: string) => void) {
  const url = URL.createObjectURL(blob);
  retainUrl(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  const liveRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const capturePromiseRef = useRef<Promise<Blob | null> | null>(null);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const model = useMemo(
    () => buildProfitCardModel(rec, { locale, livePrice, now: Date.now() }),
    [rec, locale, livePrice],
  );

  const labels = useMemo(() => profitCardLabels(model), [model]);

  const { handleProps, surfaceProps } = useSheetGesture({
    sheetRef,
    scrollRef,
    onDismiss: onClose,
    enabledQuery: "(max-width: 767px)",
  });

  const retainObjectUrl = useCallback((url: string) => {
    objectUrlsRef.current.push(url);
  }, []);

  useEffect(() => {
    if (!open) {
      blobRef.current = null;
      capturePromiseRef.current = null;
      setFailed(false);
      setCopied(false);
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
      return;
    }

    let cancelled = false;
    void loadProfitCardLogoDataUrl().then((src) => {
      if (!cancelled && src) setLogoSrc(src);
    });

    const run = async (): Promise<Blob | null> => {
      let tries = 0;
      while (!captureRef.current && tries++ < 30 && !cancelled) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (cancelled) return null;
      try {
        const blob = await captureProfitCardPng({
          offscreen: captureRef.current,
          visible: liveRef.current,
          model,
          labels,
          displayName,
        });
        if (cancelled) return blob;
        if (!(await isUsablePngBlob(blob))) {
          setFailed(true);
          return null;
        }
        blobRef.current = blob;
        setFailed(false);
        return blob;
      } catch {
        if (!cancelled) setFailed(true);
        return null;
      }
    };

    capturePromiseRef.current = run();
    return () => {
      cancelled = true;
    };
  }, [open, model, labels, displayName]);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
    };
  }, []);

  const waitForBlob = useCallback(async (): Promise<Blob | null> => {
    if (blobRef.current && (await isUsablePngBlob(blobRef.current))) return blobRef.current;
    const pending = await capturePromiseRef.current;
    if (pending && (await isUsablePngBlob(pending))) {
      blobRef.current = pending;
      return pending;
    }
    try {
      const blob = await captureProfitCardPng({
        offscreen: captureRef.current,
        visible: liveRef.current,
        model,
        labels,
        displayName,
      });
      if (!(await isUsablePngBlob(blob))) {
        setFailed(true);
        return null;
      }
      blobRef.current = blob;
      setFailed(false);
      return blob;
    } catch {
      setFailed(true);
      return null;
    }
  }, [model, labels, displayName]);

  const onDownload = useCallback(async () => {
    const blob = await waitForBlob();
    if (!blob) return;
    downloadBlob(blob, model.filename, retainObjectUrl);
  }, [waitForBlob, model.filename, retainObjectUrl]);

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
              <div ref={liveRef} data-testid="profit-card-live-preview">
                <ProfitCard
                  model={model}
                  displayName={displayName}
                  labels={labels}
                  logoSrc={logoSrc ?? undefined}
                />
              </div>
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
                  style={{
                    // Real 360×400 box, slid off-screen. Not opacity 0,
                    // not display none, not a far-off left with a 0×0 rect.
                    // html-to-image options.style resets transform on the clone.
                    left: 0,
                    top: 0,
                    width: PROFIT_CARD_CAPTURE_WIDTH,
                    height: PROFIT_CARD_CAPTURE_MIN_HEIGHT,
                    minHeight: PROFIT_CARD_CAPTURE_MIN_HEIGHT,
                    zIndex: 1,
                    opacity: 1,
                    transform: "translateX(-100vw)",
                    filter: "none",
                  }}
                >
                  <ProfitCard
                    model={model}
                    displayName={displayName}
                    labels={labels}
                    logoSrc={logoSrc ?? undefined}
                  />
                </div>,
                document.body,
              )
            : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
