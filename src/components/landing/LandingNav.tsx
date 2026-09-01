"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AiChartLogo } from "@/components/AiChartLogo";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";
import { buttonVariants } from "@/components/squareui/button";
import { SkipLink } from "@/components/foundation";
import { cn } from "@/lib/utils";

export interface LandingNavProps {
  /** The one skip link per page lives in this shared header. */
  skipTargetId?: string;
  /**
   * When false (platform default), signup is omitted so a closed gate
   * cannot be reached from the landing hamburger.
   */
  registrationOpen?: boolean;
}

/** Exact hamburger ↔ X morph: three paths, group + aria-expanded, cubic-bezier. */
function MenuMorphIcon() {
  return (
    <svg
      className="pointer-events-none size-6"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M4 12L20 12"
        className="origin-center -translate-y-[7px] transition-all duration-300 [transition-timing-function:cubic-bezier(.5,.85,.25,1.1)] group-aria-expanded:translate-x-0 group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[315deg]"
      />
      <path
        d="M4 12H20"
        className="origin-center transition-all duration-300 [transition-timing-function:cubic-bezier(.5,.85,.25,1.8)] group-aria-expanded:rotate-45"
      />
      <path
        d="M4 12H20"
        className="origin-center translate-y-[7px] transition-all duration-300 [transition-timing-function:cubic-bezier(.5,.85,.25,1.1)] group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[135deg]"
      />
    </svg>
  );
}

function routeActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function LandingNav({
  skipTargetId = "main",
  registrationOpen = true,
}: LandingNavProps) {
  const { locale, t } = useLocale();
  const pathname = usePathname() ?? "/";
  const copy = getLandingCopy(locale);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const accessHref = registrationOpen
    ? LANDING_ROUTES.signup
    : LANDING_ROUTES.pricing;

  const navigation = [
    { href: LANDING_ROUTES.home, label: t("landing.nav.home") },
    { href: LANDING_ROUTES.console, label: t("landing.nav.chat") },
    { href: LANDING_ROUTES.recommendations, label: t("nav.recommendations") },
    { href: LANDING_ROUTES.performance, label: t("nav.performance") },
  ];

  const resources = [
    { href: LANDING_ROUTES.pricing, label: t("landing.nav.pricing") },
    { href: LANDING_ROUTES.privacy, label: t("landing.nav.privacy") },
  ];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => {
      const from = (root: HTMLElement | null) =>
        Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? []);
      return [...from(headerRef.current), ...from(panelRef.current)];
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);

  const overlayLink = (href: string, label: string) => {
    const active = routeActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-12 items-center rounded-xl px-3 text-lg font-medium text-white transition-colors",
          "hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
          active && "bg-white/10",
        )}
      >
        {label}
      </Link>
    );
  };

  const overlay =
    mounted && open
      ? createPortal(
          <div
            className="fixed inset-0 z-[100]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div
              ref={panelRef}
              id={titleId}
              data-testid="landing-mobile-drawer"
              className="absolute inset-0 flex flex-col overflow-y-auto overscroll-contain"
              style={{
                background:
                  "linear-gradient(180deg, #05060a 0%, #071833 42%, #0a5cff 100%)",
              }}
            >
              <div className="h-[max(4.5rem,calc(env(safe-area-inset-top)+3.75rem))] shrink-0" />
              <nav
                className="mx-auto flex w-full max-w-lg flex-col gap-10 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-4"
                aria-label="Mobile"
              >
                <section className="space-y-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
                    {t("landing.nav.section.account")}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={LANDING_ROUTES.login}
                      onClick={() => setOpen(false)}
                      className={buttonVariants({
                        variant: "outline",
                        size: "xl",
                        className:
                          "rounded-full border-white/70 bg-transparent px-6 text-white hover:bg-white/10 hover:text-white",
                      })}
                    >
                      {t("landing.nav.login")}
                    </Link>
                    <Link
                      href={accessHref}
                      onClick={() => setOpen(false)}
                      className={buttonVariants({
                        size: "xl",
                        className:
                          "rounded-full bg-white px-6 text-[#0a4dce] hover:bg-white/90",
                      })}
                    >
                      {t("landing.nav.signup")}
                    </Link>
                  </div>
                </section>

                <section className="space-y-3 border-t border-white/10 pt-8">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
                    {t("landing.nav.section.navigation")}
                  </p>
                  <div className="flex flex-col gap-1">
                    {navigation.map((item) => overlayLink(item.href, item.label))}
                  </div>
                </section>

                <section className="space-y-3 border-t border-white/10 pt-8">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
                    {t("landing.nav.section.resources")}
                  </p>
                  <div className="flex flex-col gap-1">
                    {resources.map((item) => overlayLink(item.href, item.label))}
                  </div>
                </section>
              </nav>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <SkipLink targetId={skipTargetId}>{copy.nav.skip}</SkipLink>
      <header
        ref={headerRef}
        data-testid="landing-header"
        className="pointer-events-none absolute inset-x-0 top-0 z-[110]"
      >
        <div
          dir="ltr"
          className="flex items-center justify-between gap-3 px-4 pt-[max(0.85rem,env(safe-area-inset-top))] sm:px-6"
        >
          <Link
            href={LANDING_ROUTES.home}
            onClick={() => setOpen(false)}
            data-testid="landing-brand"
            className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-[var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <AiChartLogo
              size={28}
              showName
              forceScheme="dark"
              nameClassName="text-sm font-semibold tracking-[0.14em] text-white sm:text-base"
            />
          </Link>
          <button
            type="button"
            data-testid="landing-menu-trigger"
            aria-expanded={open}
            aria-controls={titleId}
            aria-label={open ? copy.nav.closeMenu : copy.nav.openMenu}
            onClick={() => setOpen((v) => !v)}
            className="group pointer-events-auto inline-flex size-11 appearance-none items-center justify-center border-0 bg-transparent p-0 text-white shadow-none [-webkit-tap-highlight-color:transparent] hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <MenuMorphIcon />
          </button>
        </div>
      </header>
      {overlay}
    </>
  );
}
