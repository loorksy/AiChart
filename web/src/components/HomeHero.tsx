"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { ChartBackground } from "@/components/ui/chart-background";
import { VercelV0Chat } from "@/components/ui/v0-ai-chat";

export default function HomeHero() {
  const router = useRouter();

  function handleSend(text: string) {
    sessionStorage.setItem("aichart_pending_prompt", text);
    router.push("/register");
  }

  return (
    <ChartBackground>
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold">
            Ai<span className="text-primary">Chart</span>
          </span>
        </div>
        <nav className="flex gap-2">
          <Link
            href="/login"
            className="rounded-full border border-border bg-card/80 px-4 py-2 text-sm text-foreground backdrop-blur-sm"
          >
            دخول
          </Link>
          <Link href="/register" className="btn btn-primary text-sm">
            ابدأ مجاناً
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </nav>
      </header>

      <section className="flex flex-1 flex-col justify-center pb-12">
        <VercelV0Chat
          title="ماذا ستتداول اليوم؟"
          subtitle="وكيل ذكي يراقب Binance — يتحرّك فقط عند الفرصة المناسبة."
          onSend={handleSend}
        />
      </section>

      <footer className="py-4 text-center text-xs text-muted-foreground">
        للأغراض التعليمية — ابدأ دائماً بـ Testnet
      </footer>
    </ChartBackground>
  );
}
