import { getCurrentUser } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/store";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";

export default async function AdminLimitsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">حدود التداول لكل مستخدم</h2>
        <p className="text-sm text-muted-foreground">
          تحديد المبلغ الأقصى وعدد الصفقات وصلاحية التنفيذ وحصة Claude يدوياً.
        </p>
      </div>
      <AdminUsersTable
        initialUsers={listUsersForAdmin()}
        adminId={user.id}
        mode="limits"
      />
    </div>
  );
}
