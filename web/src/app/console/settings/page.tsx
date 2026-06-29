import Link from "next/link";
import { redirect } from "next/navigation";
import {
  User,
  Link2,
  Bell,
  BrainCircuit,
  ChevronLeft,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";

interface SettingsCard {
  href: string;
  title: string;
  desc: string;
  icon: typeof User;
  adminOnly?: boolean;
}

const CARDS: SettingsCard[] = [
  {
    href: "/console/settings/profile",
    title: "الملف والمظهر",
    desc: "بياناتك، اللغة، والثيم الفاتح/الداكن",
    icon: User,
  },
  {
    href: "/console/connect",
    title: "الاتصالات",
    desc: "Binance · MetaTrader · Telegram",
    icon: Link2,
  },
  {
    href: "/console/settings/alerts",
    title: "التنبيهات",
    desc: "تفضيلات الإشعارات وسجلّها",
    icon: Bell,
  },
  {
    href: "/console/platform?tab=keys",
    title: "الذكاء الاصطناعي",
    desc: "المزوّد، المفاتيح، والنموذج",
    icon: BrainCircuit,
    adminOnly: true,
  },
];

export default async function SettingsHubPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isAdmin = user.role === "admin";
  const cards = CARDS.filter((c) => !c.adminOnly || isAdmin);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">
          اختر القسم الذي تريد ضبطه
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-secondary/40"
            >
              <span className="rounded-xl bg-primary/10 p-2.5 text-primary ring-1 ring-primary/15">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center justify-between font-semibold">
                  {c.title}
                  <ChevronLeft className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
