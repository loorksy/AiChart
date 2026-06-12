import { redirect } from "next/navigation";

export default function AdminSystemRedirect() {
  redirect("/console/platform?tab=system");
}
