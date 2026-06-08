import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getBinanceAccountMeta,
  getSettings,
  isOnboardingDone,
} from "@/lib/store";
import OnboardingClient from "@/components/OnboardingClient";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin" || isOnboardingDone(user.id)) {
    redirect("/dashboard");
  }

  const settings = getSettings(user.id);
  const binance = getBinanceAccountMeta(user.id);

  return (
    <OnboardingClient
      settings={settings}
      hasBinance={Boolean(binance)}
    />
  );
}
