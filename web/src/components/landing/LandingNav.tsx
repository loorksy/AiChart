"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { LANDING } from "@/components/landing/landingContent";

export function LandingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold">
            Ai<span className="text-primary">Chart</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {LANDING.nav.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-foreground">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex gap-2">
          <Link
            href="/login"
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            دخول
          </Link>
          <Link href="/signup" className="btn btn-primary text-sm">
            {LANDING.hero.ctaPrimary}
          </Link>
        </div>
      </div>
    </header>
  );
}
