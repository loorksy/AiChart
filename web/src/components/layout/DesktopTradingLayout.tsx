"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DesktopTradingLayout({
  sessions,
  chart,
  chat,
  tools,
  bottom,
  mode = "split",
  className,
}: {
  sessions?: ReactNode;
  chart: ReactNode;
  chat?: ReactNode;
  tools?: ReactNode;
  bottom?: ReactNode;
  mode?: "chart" | "chat" | "split";
  className?: string;
}) {
  return (
    <div className={cn("hidden h-dvh min-h-0 grid-cols-[260px_minmax(0,1fr)_380px] grid-rows-[auto_minmax(0,1fr)_auto] gap-2 p-2 lg:grid", className)}>
      <aside className="row-span-3 min-h-0 overflow-hidden rounded-2xl border border-border bg-card/70">{sessions}</aside>
      <header className="col-start-2 col-end-4 rounded-2xl border border-border bg-card/70 p-2">{tools}</header>
      <main className={cn("min-h-0 overflow-hidden rounded-2xl border border-border bg-card/70", mode === "chat" && "hidden")}>{chart}</main>
      <aside className={cn("min-h-0 overflow-hidden rounded-2xl border border-border bg-card/70", mode === "chart" && "hidden")}>{chat}</aside>
      {bottom && <footer className="col-start-2 col-end-4 rounded-2xl border border-border bg-card/70 p-2">{bottom}</footer>}
    </div>
  );
}
