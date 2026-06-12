import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOnboardingDone } from "@/lib/store";
import BridgeShell from "@/components/bridge/BridgeShell";

export const metadata: Metadata = {
  title: "AiChart Bridge — مركز الجسر",
  description: "جسر OpenClaw ↔ Binance / MT5 — اتصالات، مخاطر، ومراقبة.",
};

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console");
  if (user.role !== "admin" && !(await isOnboardingDone(user.id))) {
    redirect("/onboarding");
  }

  return (
    <BridgeShell email={user.email} role={user.role}>
      {children}
    </BridgeShell>
  );
}
