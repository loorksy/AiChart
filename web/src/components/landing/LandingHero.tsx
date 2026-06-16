"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { VercelV0Chat } from "@/components/ui/v0-ai-chat";
import { LANDING } from "@/components/landing/landingContent";

export function LandingHero() {
  const router = useRouter();

  function handleSend(text: string) {
    sessionStorage.setItem("aichart_pending_prompt", text);
    router.push("/signup");
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="space-y-6 text-center lg:text-right">
          <p className="text-sm font-medium text-primary">{LANDING.tagline}</p>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">
            {LANDING.hero.title}
          </h1>
          <p className="text-base text-muted-foreground sm:text-lg">
            {LANDING.hero.subtitle}
          </p>
          <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
            <Link href="/signup" className="btn btn-primary inline-flex gap-1">
              {LANDING.hero.ctaPrimary}
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn btn-secondary">
              {LANDING.hero.ctaSecondary}
            </Link>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card/50 p-2 backdrop-blur-sm">
          <VercelV0Chat
            title={LANDING.hero.chatTitle}
            subtitle={LANDING.hero.chatSubtitle}
            onSend={handleSend}
          />
        </div>
      </div>
    </section>
  );
}
