import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "AiChart Admin — مركز التحكّم",
  description: "لوحة إدارة منصة AiChart — منفصلة عن واجهة المتداولين.",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/dashboard");

  return <AdminShell email={user.email}>{children}</AdminShell>;
}
