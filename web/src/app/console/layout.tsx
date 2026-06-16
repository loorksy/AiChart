import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import BridgeShell from "@/components/bridge/BridgeShell";
import UserShell from "@/components/user/UserShell";

export const metadata: Metadata = {
  title: "AiChart — لوحة التحكم",
  description: "منصة AiChart — Claude MCP · Binance · MT5",
};

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console");
  if (user.role !== "admin" && !hasPlatformAccess(user)) {
    redirect("/awaiting-approval");
  }

  if (user.role === "admin") {
    return (
      <BridgeShell email={user.email} role={user.role}>
        {children}
      </BridgeShell>
    );
  }

  return <UserShell user={user}>{children}</UserShell>;
}
