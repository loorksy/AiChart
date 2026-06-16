import Link from "next/link";
import { LANDING } from "@/components/landing/landingContent";

export function LandingFooter() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center text-sm text-muted-foreground sm:px-6">
        <nav className="flex gap-4">
          {LANDING.footer.links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <p>{LANDING.footer.disclaimer}</p>
        <p className="text-xs">© {new Date().getFullYear()} AiChart</p>
      </div>
    </footer>
  );
}
