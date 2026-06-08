import {
  getAdminPlatformStats,
  isMasterKillOn,
} from "@/lib/store";
import { AdminOverview } from "@/components/admin/AdminOverview";

export default async function AdminOverviewPage() {
  return (
    <AdminOverview
      stats={await getAdminPlatformStats()}
      masterKill={await isMasterKillOn()}
    />
  );
}
