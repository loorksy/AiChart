import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listUsersForAdmin, isMasterKillOn } from "@/lib/store";
import Nav from "@/components/Nav";
import AdminClient from "@/components/AdminClient";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <>
      <Nav email={user.email} role={user.role} />
      <AdminClient
        initialUsers={listUsersForAdmin()}
        adminId={user.id}
        initialMasterKill={isMasterKillOn()}
      />
    </>
  );
}
