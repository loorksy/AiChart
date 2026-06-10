import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOnboardingDone } from "@/lib/store";
import AppShell from "@/components/AppShell";
import SignalsWizardClient from "@/components/SignalsWizardClient";

export default async function SignalsNewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && !(await isOnboardingDone(user.id))) {
    redirect("/onboarding");
  }

  return (
    <AppShell email={user.email} role={user.role} chatLayout>
      <SignalsWizardClient />
    </AppShell>
  );
}
