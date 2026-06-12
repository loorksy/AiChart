import { redirect } from "next/navigation";
import { isSingleUserMode } from "@/lib/agentAuth";

export default function AdminUsersRedirect() {
  redirect(isSingleUserMode() ? "/console/platform" : "/console/platform");
}
