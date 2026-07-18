"use client";

import SettingsClient from "@/components/SettingsClient";
import { SurfaceCard } from "@/components/ui/shell";
import { useLocale } from "@/hooks/useLocale";
import type { ComponentProps } from "react";

type Props = Omit<
  ComponentProps<typeof SettingsClient>,
  "embedMode" | "visibleTabs" | "initialTab"
>;

export function ConnectSection(props: Props) {
  const { t } = useLocale();

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <h2 className="text-xl font-semibold tracking-tight">{t("connect.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("connect.subtitle")}</p>
      </SurfaceCard>
      <SettingsClient
        {...props}
        embedMode
        visibleTabs={["integrations", "alerts"]}
        initialTab="integrations"
      />
    </div>
  );
}
