import { getCurrentUser } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/store";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const pending = (await listUsersForAdmin()).filter(
    (u) => u.status === "pending" && u.role !== "admin",
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">إدارة المستخدمين</h2>
        <p className="text-sm text-muted-foreground">
          عرض وتفعيل وتعليق وحذف المستخدمين — {pending} بانتظار الموافقة.
        </p>
      </div>
      <AdminUsersTable
        initialUsers={await listUsersForAdmin()}
        adminId={user.id}
        mode="full"
      />
    </div>
  );
}
