"use client";

import Image from "next/image";
import { currencyMark, pairMarks, type CurrencyMark } from "@/lib/markets/currencyFlags";
import { cn } from "@/lib/utils";

const METAL_TINT: Record<string, string> = {
  gold: "bg-[linear-gradient(140deg,#f5d67b,#b8860b)] text-[#3a2a00]",
  silver: "bg-[linear-gradient(140deg,#e8ecf1,#9aa3ad)] text-[#2b3138]",
  platinum: "bg-[linear-gradient(140deg,#dfe7ef,#8e9aa6)] text-[#232a31]",
};

/**
 * One currency as a disc: the sovereign's flag, a metal's own colour, or the
 * bare code when neither applies. Square (1:1) artwork, so the circular crop
 * never slices the design off-centre the way a 3:2 flag would.
 */
export function CurrencyFlag({
  currency,
  size = 22,
  className,
}: {
  currency: string;
  size?: number;
  className?: string;
}) {
  return <MarkDisc mark={currencyMark(currency)} size={size} className={className} />;
}

function MarkDisc({
  mark,
  size,
  className,
}: {
  mark: CurrencyMark;
  size: number;
  className?: string;
}) {
  const shell = cn(
    "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-border/70",
    className,
  );
  const style = { width: size, height: size };

  if (mark.kind === "flag") {
    return (
      <span className={shell} style={style} aria-hidden>
        <Image
          src={mark.src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          unoptimized
        />
      </span>
    );
  }

  if (mark.kind === "metal") {
    return (
      <span
        className={cn(shell, METAL_TINT[mark.tint] ?? METAL_TINT.gold)}
        style={style}
        aria-hidden
      >
        <span className="text-[9px] font-bold leading-none" dir="ltr">
          {mark.short}
        </span>
      </span>
    );
  }

  return (
    <span className={cn(shell, "bg-muted text-muted-foreground")} style={style} aria-hidden>
      <span className="text-[8px] font-bold leading-none" dir="ltr">
        {mark.code.slice(0, 2)}
      </span>
    </span>
  );
}

/**
 * Both sides of a pair, overlapped — the base in front of the quote, the way
 * every quote board and banking app draws a conversion.
 */
export function PairFlags({
  symbol,
  size = 22,
  className,
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const { base, quote } = pairMarks(symbol);
  return (
    // Always LTR: the base currency leads the pair name in every market,
    // including on an Arabic screen where the text around it runs the other way.
    <span className={cn("inline-flex shrink-0 items-center", className)} dir="ltr">
      <MarkDisc mark={base} size={size} className="z-10" />
      {quote && (
        <MarkDisc
          mark={quote}
          size={size}
          className="-ms-2 ring-background"
        />
      )}
    </span>
  );
}
