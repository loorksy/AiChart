import { listAuditLogs } from "@/lib/store";
import { AdminSecurityPanel } from "@/components/admin/AdminSecurityPanel";

export default async function AdminSecurityPage() {
  return <AdminSecurityPanel audit={await listAuditLogs(100)} />;
}
