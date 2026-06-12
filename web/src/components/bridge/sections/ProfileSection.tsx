"use client";

import SettingsClient from "@/components/SettingsClient";
import type { ComponentProps } from "react";

type Props = Omit<
  ComponentProps<typeof SettingsClient>,
  "embedMode" | "visibleTabs" | "initialTab"
>;

export function ProfileSection(props: Props) {
  return (
    <SettingsClient
      {...props}
      embedMode
      visibleTabs={["profile", "appearance"]}
      initialTab="profile"
    />
  );
}
