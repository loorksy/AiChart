import { listClaudeUsageForAdmin } from "@/lib/store";
import { AdminUsagePanel } from "@/components/admin/AdminUsagePanel";

export default function AdminUsagePage() {
  return <AdminUsagePanel initialUsage={listClaudeUsageForAdmin()} />;
}
