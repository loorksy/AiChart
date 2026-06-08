"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function Nav({
  email,
  role,
}: {
  email: string;
  role: "user" | "admin";
}) {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { href: "/dashboard", label: "اللوحة" },
    { href: "/settings", label: "الإعدادات" },
    ...(role === "admin" ? [{ href: "/admin", label: "الإدارة" }] : []),
  ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-xl font-extrabold">
            Ai<span className="text-[var(--accent)]">Chart</span>
          </Link>
          <nav className="flex gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  pathname === l.href
                    ? "bg-[var(--surface-2)] text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[var(--muted)] sm:inline" dir="ltr">
            {email}
          </span>
          <button onClick={logout} className="btn btn-secondary py-1.5 text-sm">
            خروج
          </button>
        </div>
      </div>
    </header>
  );
}
