import { Shield } from "lucide-react";
import { LANDING } from "@/components/landing/landingContent";

export function LandingSecurity() {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-center gap-8 rounded-2xl border border-primary/20 bg-primary/5 p-8 sm:flex-row sm:p-10">
          <Shield className="h-16 w-16 shrink-0 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">{LANDING.security.title}</h2>
            <ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              {LANDING.security.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
