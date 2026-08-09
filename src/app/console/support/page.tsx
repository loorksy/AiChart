import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SupportClient } from "@/components/support/SupportClient";

export const metadata = { title: "الدعم الفني" };

/** V2-C (#97): tickets — instant bot answer, human escalation on request. */
export default async function SupportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/support");
  return (
    <main className="page-shell max-w-3xl space-y-6">
      <SupportClient />
    </main>
  );
}
