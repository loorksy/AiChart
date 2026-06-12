import { redirect } from "next/navigation";

export default function AdminKeysRedirect() {
  redirect("/console/platform?tab=keys");
}
