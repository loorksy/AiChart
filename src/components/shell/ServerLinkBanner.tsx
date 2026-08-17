"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import {
  getServerLink,
  subscribeServerLink,
} from "@/lib/connectionWatchdog";

/** Quiet strip when the origin probe fails — the chrome still works. */
export function ServerLinkBanner() {
  const { t } = useLocale();
  const [down, setDown] = useState(() => getServerLink() === "down");

  useEffect(() => subscribeServerLink((next) => setDown(next === "down")), []);

  if (!down) return null;
  return (
    <div
      role="status"
      data-testid="server-link-banner"
      className="border-b border-border bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground"
    >
      {t("layout.server_reconnecting")}
    </div>
  );
}
