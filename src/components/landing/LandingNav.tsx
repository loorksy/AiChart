"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Globe, Menu, Moon, Sun, X } from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import { useTheme } from "@/components/ThemeProvider";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";
import { Button, buttonVariants } from "@/components/squareui/button";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import { MetalIconButton } from "@/components/ui/metal-icon-button";
import { SkipLink } from "@/components/foundation";
import { cn } from "@/lib/utils";

export interface LandingNavLink {
  /** Href rendered verbatim — must be an existing route (or file, e.g. RSS). */
  href: string;
  label: string;
  /** Plain anchor instead of a client-side <Link> (e.g. /blog/rss.xml). */
  external?: boolean;
}

export interface LandingNavProps {
  /**
   * `full` (default): one-screen landing — hamburger only, real product routes.
   * `compact`: host-page route links — used on /pricing.
   */
  variant?: "full" | "compact";
  /** Compact-variant route links, hrefs passed through untouched. */
  links?: LandingNavLink[];
  /** Optional server-rendered action slot (e.g. pricing's billing link). */
  actions?: React.ReactNode;
  /** The one skip link per page lives in this shared header. */
  skipTargetId?: string;
  /**
   * When false (platform default), signup is omitted so a closed gate
   * cannot be reached from the landing hamburger.
   */
  registrationOpen?: boolean;
}

export function LandingNav({
  variant = "full",
  links = [],
  actions,
  skipTargetId = "main",
  registrationOpen = true,
}: LandingNavProps) {
  const { locale, setLocale, t } = useLocale();
  const { resolved, setTheme } = useTheme();
  const c = getLandingCopy(locale);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const isDark = resolved === "dark";
  const isHorizon = variant === "full";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const selector =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(selector) ?? []);
    focusables()[0]?.focus();
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

  const linkClass = isHorizon
    ? "flex min-h-11 items-center rounded-[var(--radius)] px-3 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 sm:min-h-9"
    : "flex min-h-11 items-center rounded-[var(--radius)] px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9";

  const horizonLinks = [
    { href: LANDING_ROUTES.login, label: t("landing.nav.login") },
    ...(registrationOpen
      ? [{ href: LANDING_ROUTES.signup, label: t("landing.nav.signup") }]
      : []),
    { href: LANDING_ROUTES.pricing, label: t("landing.nav.pricing") },
    { href: LANDING_ROUTES.console, label: t("landing.nav.chat") },
  ];

  const navLinks =
    variant === "full" ? (
      <>
        {horizonLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={linkClass}
          >
            {item.label}
          </Link>
        ))}
      </>
    ) : (
      <>
        {links.map((item) =>
          item.external ? (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={linkClass}
            >
              {item.label}
            </a>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={linkClass}
            >
              {item.label}
            </Link>
          ),
        )}
      </>
    );

  const drawerSurface = isHorizon
    ? {
        backgroundColor: "rgba(8, 10, 16, 0.96)",
        color: "#ffffff",
      }
    : {
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      };

  const mobileMenu =
    mounted && open
      ? createPortal(
          <div
            className="fixed inset-0 z-[100]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/55 animate-landing-backdrop"
              aria-label={c.nav.closeMenu}
              onClick={() => setOpen(false)}
            />
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4">
              <div
                ref={panelRef}
                id={titleId}
                data-testid="landing-mobile-drawer"
                className={cn(
                  "pointer-events-auto flex w-full max-w-sm flex-col overflow-hidden rounded-[var(--radius-lg)] border elevation-3 animate-landing-modal",
                  isHorizon ? "border-white/15" : "border-border",
                )}
                style={drawerSurface}
              >
                <div
                  className={cn(
                    "flex h-14 shrink-0 items-center justify-between border-b px-4",
                    isHorizon ? "border-white/10" : "border-border",
                  )}
                >
                  <AiChartLogo
                    size={28}
                    showName
                    nameClassName={cn(
                      "text-sm font-semibold",
                      isHorizon && "text-white",
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className={cn("tap-target", isHorizon && "text-white hover:bg-white/10")}
                    aria-label={c.nav.closeMenu}
                    onClick={() => setOpen(false)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <nav className="flex flex-col gap-0.5 p-3" aria-label="Mobile">
                  {navLinks}
                </nav>
                <div
                  className={cn(
                    "space-y-2 border-t p-3",
                    isHorizon ? "border-white/10" : "border-border",
                  )}
                >
                  <button
                    type="button"
                    data-testid={isHorizon ? "landing-theme-toggle" : undefined}
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                    className={linkClass}
                  >
                    {isDark ? (
                      <Sun className="me-2 h-4 w-4" />
                    ) : (
                      <Moon className="me-2 h-4 w-4" />
                    )}
                    {c.nav.theme}
                  </button>
                  <button
                    type="button"
                    data-testid={isHorizon ? "landing-locale-toggle" : undefined}
                    onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
                    className={linkClass}
                  >
                    <Globe className="me-2 h-4 w-4" />
                    {c.nav.language}
                  </button>
                  <Link
                    href={LANDING_ROUTES.login}
                    onClick={() => setOpen(false)}
                    className={buttonVariants({
                      variant: "outline",
                      size: "xl",
                      className: isHorizon
                        ? "w-full border-white/20 bg-transparent text-white hover:bg-white/10"
                        : "w-full",
                    })}
                  >
                    {c.nav.signIn}
                  </Link>
                  {registrationOpen ? (
                    <Link
                      href={LANDING_ROUTES.signup}
                      onClick={() => setOpen(false)}
                      className={buttonVariants({
                        size: "xl",
                        className: isHorizon
                          ? "w-full bg-white text-black hover:bg-white/90"
                          : "w-full",
                      })}
                    >
                      {c.nav.primaryCta}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (isHorizon) {
    return (
      <>
        <SkipLink targetId={skipTargetId}>{c.nav.skip}</SkipLink>
        <header
          data-testid="landing-header"
          className="pointer-events-none absolute inset-x-0 top-0 z-50"
        >
          <div
            dir="ltr"
            className="flex justify-end px-4 pt-[max(0.85rem,env(safe-area-inset-top))] sm:px-6"
          >
            <button
              type="button"
              data-testid="landing-menu-trigger"
              aria-expanded={open}
              aria-controls={titleId}
              aria-label={open ? c.nav.closeMenu : c.nav.openMenu}
              onClick={() => setOpen((v) => !v)}
              className="pointer-events-auto flex size-11 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </header>
        {mobileMenu}
      </>
    );
  }

  return (
    <>
      <SkipLink targetId={skipTargetId}>{c.nav.skip}</SkipLink>
      <header
        data-testid="landing-header"
        className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            href={LANDING_ROUTES.home}
            className="flex shrink-0 items-center gap-2 rounded-[var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AiChartLogo
              size={32}
              showName
              nameClassName="text-base font-semibold tracking-tight text-foreground"
            />
          </Link>

          <nav
            className="ms-auto hidden items-center gap-0.5 md:flex"
            aria-label="Primary"
          >
            {navLinks}
          </nav>

          <div className="ms-auto flex items-center gap-1.5 md:ms-2">
            <span className="hidden sm:inline-flex">
              <MetalIconButton
                data-testid="landing-theme-toggle"
                onClick={() => setTheme(isDark ? "light" : "dark")}
                aria-label={c.nav.theme}
                title={c.nav.theme}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </MetalIconButton>
            </span>
            <span className="hidden sm:inline-flex">
              <MetalIconButton
                data-testid="landing-locale-toggle"
                onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
                aria-label={c.nav.language}
                title={c.nav.language}
              >
                <Globe className="h-4 w-4" />
              </MetalIconButton>
            </span>
            {actions}
            <Link
              href={LANDING_ROUTES.login}
              className={buttonVariants({
                variant: "ghost",
                className:
                  "hidden text-muted-foreground hover:text-foreground sm:inline-flex",
              })}
            >
              {c.nav.signIn}
            </Link>
            {registrationOpen ? (
              <LiquidMetalButton
                href={LANDING_ROUTES.signup}
                label={c.nav.primaryCta}
                data-testid="landing-primary-cta"
              />
            ) : null}
            <span className="md:hidden">
              <MetalIconButton
                data-testid="landing-menu-trigger"
                aria-expanded={open}
                aria-controls={titleId}
                aria-label={open ? c.nav.closeMenu : c.nav.openMenu}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </MetalIconButton>
            </span>
          </div>
        </div>
        {mobileMenu}
      </header>
    </>
  );
}
