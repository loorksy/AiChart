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
      <div className="glass-card border-primary/25 p-4">
        <h2 className="text-xl font-bold">الاتصالات</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          MetaTrader · Telegram
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
