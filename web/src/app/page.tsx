import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOnboardingDone } from "@/lib/store";
import HomeHero from "@/components/HomeHero";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    redirect(
      user.role === "admin" || (await isOnboardingDone(user.id))
        ? "/dashboard"
        : "/onboarding",
    );
  }

  return <HomeHero />;
}
