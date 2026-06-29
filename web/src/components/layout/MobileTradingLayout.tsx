"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { BarChart3, MessageSquare, Settings, User, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "chart" | "chat" | "trades" | "account" | "settings";

const tabs: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: "chart", label: "الشارت", icon: BarChart3 },
  { id: "chat", label: "الدردشة", icon: MessageSquare },
  { id: "trades", label: "الصفقات", icon: WalletCards },
  { id: "account", label: "الحساب", icon: User },
  { id: "settings", label: "الإعدادات", icon: Settings },
];

export function MobileTradingLayout({
  chart,
  chat,
  trades,
  account,
  settings,
  initialTab = "chart",
}: {
  chart: ReactNode;
  chat: ReactNode;
  trades?: ReactNode;
  account?: ReactNode;
  settings?: ReactNode;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const content = { chart, chat, trades, account, settings }[tab];
  return (
    <div className="flex h-dvh flex-col lg:hidden">
      <main className="min-h-0 flex-1 overflow-hidden">{content}</main>
      <nav className="grid grid-cols-5 border-t border-border bg-card/95 backdrop-blur">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className={cn("flex flex-col items-center gap-1 px-1 py-2 text-[10px]", tab === item.id ? "text-primary" : "text-muted-foreground")}>
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
