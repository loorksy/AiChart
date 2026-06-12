"use client";

import SettingsClient from "@/components/SettingsClient";
import type { ComponentProps } from "react";

type Props = Omit<
  ComponentProps<typeof SettingsClient>,
  "embedMode" | "visibleTabs" | "initialTab"
> & {
  adminLimitsSlot?: React.ReactNode;
};

export function TradingRiskSection({ adminLimitsSlot, ...props }: Props) {
  return (
    <div className="space-y-6" id="kill">
      <div>
        <h2 className="text-xl font-bold">التداول والمخاطر</h2>
        <p className="text-sm text-muted-foreground">
          أوضاع الوكيل، الحدود، Kill Switch
        </p>
      </div>
      <SettingsClient
        {...props}
        embedMode
        visibleTabs={["trading"]}
        initialTab="trading"
      />
      {adminLimitsSlot}
    </div>
  );
}
