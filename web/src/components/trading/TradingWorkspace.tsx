"use client";

import type { ReactNode } from "react";
import { DesktopTradingLayout } from "@/components/layout/DesktopTradingLayout";
import { MobileTradingLayout } from "@/components/layout/MobileTradingLayout";

export function TradingWorkspace({ sessions, chart, chat, tools, trades, account, settings }: { sessions?: ReactNode; chart: ReactNode; chat: ReactNode; tools?: ReactNode; trades?: ReactNode; account?: ReactNode; settings?: ReactNode }) {
  return (
    <>
      <DesktopTradingLayout sessions={sessions} chart={chart} chat={chat} tools={tools} bottom={trades} />
      <MobileTradingLayout chart={chart} chat={chat} trades={trades} account={account} settings={settings} />
    </>
  );
}
