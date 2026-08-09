"use client";

import SettingsClient from "@/components/SettingsClient";
import type { ComponentProps } from "react";

type Props = Omit<
  ComponentProps<typeof SettingsClient>,
  "embedMode" | "visibleTabs" | "initialTab"
>;

/** Alerts preferences + log as a standalone settings route. */
export function AlertsSection(props: Props) {
  return (
    <SettingsClient
      {...props}
      embedMode
      visibleTabs={["alerts"]}
      initialTab="alerts"
    />
  );
}
