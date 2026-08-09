import { redirect } from "next/navigation";

/** Merged into the unified performance page — keep old links working. */
export default function StatisticsPage() {
  redirect("/performance#statistics");
}
