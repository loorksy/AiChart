import { listClaudeUsageForAdmin } from "@/lib/store";
import { AdminUsagePanel } from "@/components/admin/AdminUsagePanel";

export default async function AdminUsagePage() {
  return <AdminUsagePanel initialUsage={await listClaudeUsageForAdmin()} />;
}
