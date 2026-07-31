import { redirect } from "next/navigation";

/** Merged into the unified performance page — keep old links working.
 *  The /recommendations/[id] detail view stays. */
export default function RecommendationsPage() {
  redirect("/performance#recommendations");
}
