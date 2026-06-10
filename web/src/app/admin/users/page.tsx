import { getCurrentUser } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/store";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import { isSingleUserMode } from "@/lib/agentAuth";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (isSingleUserMode()) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <h2 className="text-xl font-bold">إدارة المستخدمين</h2>
        <div className="card p-6 text-sm text-muted-foreground">
          المنصة تعمل بوضع <b>المستخدم الواحد</b> — التسجيل معطّل وإدارة
          المستخدمين غير مطلوبة. لإعادة وضع SaaS عيّن{" "}
          <code dir="ltr">AICHART_SINGLE_USER=0</code> في البيئة.
        </div>
      </div>
    );
  }

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
