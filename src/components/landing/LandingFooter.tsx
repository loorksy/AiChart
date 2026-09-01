"use client";

import Link from "next/link";
import { AiChartLogo } from "@/components/AiChartLogo";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";

export function LandingFooter({
  registrationOpen = false,
}: {
  registrationOpen?: boolean;
}) {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).footer;
  const accessHref = registrationOpen
    ? LANDING_ROUTES.signup
    : LANDING_ROUTES.pricing;

  return (
    <footer
      data-testid="landing-footer"
      className="relative z-10 border-t border-white/10 bg-transparent"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <Link
            href={LANDING_ROUTES.home}
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <AiChartLogo
              size={28}
              showName
              forceScheme="dark"
              nameClassName="text-sm font-semibold tracking-[0.14em] text-white"
            />
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            {c.blurb}
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
            {c.product}
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={accessHref} className="text-white/80 hover:underline">
                {c.openPlatform}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.login} className="text-white/80 hover:underline">
                {getLandingCopy(locale).nav.signIn}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.home} className="text-white/80 hover:underline">
                {c.features}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.home} className="text-white/80 hover:underline">
                {c.how}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
            {c.legal}
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={LANDING_ROUTES.privacy} className="text-white/80 hover:underline">
                {c.privacy}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.terms} className="text-white/80 hover:underline">
                {c.terms}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.agreement} className="text-white/80 hover:underline">
                {c.agreement}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.risk} className="text-white/80 hover:underline">
                {c.risk}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
            {c.company}
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href={LANDING_ROUTES.about} className="text-white/80 hover:underline">
                {c.about}
              </Link>
            </li>
            <li>
              <Link href={LANDING_ROUTES.contact} className="text-white/80 hover:underline">
                {c.contact}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-white/45 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <p>{c.disclaimer}</p>
          <p className="shrink-0">{c.rights}</p>
        </div>
      </div>
    </footer>
  );
}
