import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPlatformAccess } from "@/lib/platformAccess";
import LandingPage from "@/components/landing/LandingPage";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    if (user.role !== "admin" && !hasPlatformAccess(user)) {
      redirect("/awaiting-approval");
    }
    redirect("/console");
  }

  return <LandingPage />;
}
