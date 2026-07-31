import { redirect } from "next/navigation";

/** Merged into the unified performance page — keep old links working. */
export default function ConsoleTradesPage() {
  redirect("/performance#trades");
}
