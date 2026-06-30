"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "اللوحة" },
  { href: "/chart", label: "الشارت" },
  { href: "/trades", label: "الصفقات" },
  { href: "/settings", label: "الإعدادات" },
];

export default function Nav({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-card/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="text-lg font-bold">
          Ai<span className="text-primary">Chart</span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-[var(--radius)] px-3 py-1.5 text-sm transition ${
                pathname === l.href
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="hidden text-sm text-muted-foreground sm:inline" dir="ltr">
          {email}
        </span>
      </div>
    </header>
  );
}
