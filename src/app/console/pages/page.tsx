import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import PagesCmsClient from "./PagesCmsClient";

export default async function ConsolePagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/console");

  return <PagesCmsClient />;
}
