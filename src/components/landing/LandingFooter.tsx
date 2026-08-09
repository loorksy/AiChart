"use client";

import Link from "next/link";
import { AiChartLogo } from "@/components/AiChartLogo";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";

export function LandingFooter() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).footer;

  return (
    <footer
      data-testid="landing-footer"
      className="border-t border-border bg-background"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <Link
            href={LANDING_ROUTES.home}
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AiChartLogo
              size={28}
              showName
              nameClassName="text-sm font-semibold tracking-tight"
            />
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {c.blurb}
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {c.product}
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={LANDING_ROUTES.signup} className="text-foreground/90 hover:underline">
                {c.openPlatform}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.login} className="text-foreground/90 hover:underline">
                {getLandingCopy(locale).nav.signIn}
              </Link>
            </li>
            <li>
              <a href="#features" className="text-foreground/90 hover:underline">
                {c.features}
              </a>
            </li>
            <li>
              <a href="#how" className="text-foreground/90 hover:underline">
                {c.how}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {c.legal}
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={LANDING_ROUTES.privacy} className="text-foreground/90 hover:underline">
                {c.privacy}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.terms} className="text-foreground/90 hover:underline">
                {c.terms}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.agreement} className="text-foreground/90 hover:underline">
                {c.agreement}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.risk} className="text-foreground/90 hover:underline">
                {c.risk}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {c.company}
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={LANDING_ROUTES.about} className="text-foreground/90 hover:underline">
                {c.about}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.contact} className="text-foreground/90 hover:underline">
                {c.contact}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <p>{c.disclaimer}</p>
          <p className="shrink-0">{c.rights}</p>
        </div>
      </div>
    </footer>
  );
}
