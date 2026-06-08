import { listAuditLogs } from "@/lib/store";
import { AdminSecurityPanel } from "@/components/admin/AdminSecurityPanel";

export default function AdminSecurityPage() {
  return <AdminSecurityPanel audit={listAuditLogs(100)} />;
}
