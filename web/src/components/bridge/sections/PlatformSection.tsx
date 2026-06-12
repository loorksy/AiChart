"use client";

import { useSearchParams } from "next/navigation";
import type { ClaudeUsageRow } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AdminKeysPanel } from "@/components/admin/AdminKeysPanel";
import { AdminSystemPanel } from "@/components/admin/AdminSystemPanel";
import { AdminSecurityPanel } from "@/components/admin/AdminSecurityPanel";
import { AdminUsagePanel } from "@/components/admin/AdminUsagePanel";
import { OpenClawConsoleClient } from "@/components/agent/OpenClawConsoleClient";
import { ProfileSection } from "@/components/bridge/sections/ProfileSection";
import type { ComponentProps } from "react";

const TABS = [
  { id: "keys", label: "المفاتيح" },
  { id: "system", label: "النظام" },
  { id: "security", label: "الأمن" },
  { id: "usage", label: "الاستهلاك" },
  { id: "profile", label: "الملف" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type AuditRow = {
  id: number;
  user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
};

type ProfileProps = ComponentProps<typeof ProfileSection>;

export function PlatformSection({
  isAdmin,
  profileProps,
  audit = [],
  usage = [],
}: {
  isAdmin: boolean;
  profileProps: ProfileProps;
  audit?: AuditRow[];
  usage?: ClaudeUsageRow[];
}) {
  const params = useSearchParams();
  const tabParam = params.get("tab") as TabId | null;
  const defaultTab: TabId = isAdmin ? "keys" : "profile";
  const requestedTab =
    tabParam && TABS.some((t) => t.id === tabParam) ? tabParam : defaultTab;
  const tab: TabId =
    !isAdmin && requestedTab !== "profile" ? "profile" : requestedTab;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">المنصة والمفاتيح</h2>
        <p className="text-sm text-muted-foreground">
          OpenClaw، مفاتيح API، الأمن
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.filter((t) => isAdmin || t.id === "profile").map((t) => (
          <a
            key={t.id}
            href={`/console/platform?tab=${t.id}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </a>
        ))}
      </div>

      {tab === "keys" && isAdmin && <AdminKeysPanel />}
      {tab === "system" && isAdmin && (
        <div className="space-y-4">
          <OpenClawConsoleClient />
          <AdminSystemPanel />
        </div>
      )}
      {tab === "security" && isAdmin && (
        <AdminSecurityPanel audit={audit} />
      )}
      {tab === "usage" && isAdmin && (
        <AdminUsagePanel initialUsage={usage} />
      )}
      {tab === "profile" && <ProfileSection {...profileProps} />}
    </div>
  );
}
