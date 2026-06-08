import {
  getAdminPlatformStats,
  isMasterKillOn,
} from "@/lib/store";
import { AdminOverview } from "@/components/admin/AdminOverview";

export default function AdminOverviewPage() {
  return (
    <AdminOverview
      stats={getAdminPlatformStats()}
      masterKill={isMasterKillOn()}
    />
  );
}
