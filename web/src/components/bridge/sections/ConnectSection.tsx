"use client";

import SettingsClient from "@/components/SettingsClient";
import type { ComponentProps } from "react";

type Props = Omit<
  ComponentProps<typeof SettingsClient>,
  "embedMode" | "visibleTabs" | "initialTab"
>;

export function ConnectSection(props: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">الاتصالات</h2>
        <p className="text-sm text-muted-foreground">
          Binance · MT5 · Telegram
        </p>
      </div>
      <SettingsClient
        {...props}
        embedMode
        visibleTabs={["integrations", "alerts"]}
        initialTab="integrations"
      />
    </div>
  );
}
