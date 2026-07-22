"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Globe, Menu, Moon, Sun, X } from "lucide-react";
import { AiChartLogo } from "@/components/AiChartLogo";
import { useTheme } from "@/components/ThemeProvider";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";
import { cn } from "@/lib/utils";

const ANCHORS = [
  { href: "#features", key: "features" as const },
  { href: "#how", key: "how" as const },
  { href: "#stats", key: "stats" as const },
  { href: "#trust", key: "trust" as const },
  { href: "#pricing", key: "pricing" as const },
  { href: "#faq", key: "faq" as const },
];

export function LandingNav() {
  const { locale, setLocale } = useLocale();
  const { resolved, setTheme } = useTheme();
  const c = getLandingCopy(locale);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const isDark = resolved === "dark";

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

  const navLinks = (
    <>
      {ANCHORS.map((item) => (
        <a
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {c.nav[item.key]}
        </a>
      ))}
    </>
  );

  const mobileMenu =
    mounted && open
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] md:hidden"
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
                  "pointer-events-auto flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border shadow-xl animate-landing-modal",
                )}
                style={{
                  backgroundColor: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                  <AiChartLogo
                    size={28}
                    showName
                    nameClassName="text-sm font-semibold"
                  />
                  <button
                    type="button"
                    className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={c.nav.closeMenu}
                    onClick={() => setOpen(false)}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <nav className="flex flex-col gap-0.5 p-3" aria-label="Mobile">
                  {navLinks}
                </nav>
                <div className="space-y-2 border-t border-border p-3">
                  <button
                    type="button"
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isDark ? (
                      <Sun className="h-4 w-4" />
                    ) : (
                      <Moon className="h-4 w-4" />
                    )}
                    {c.nav.theme}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Globe className="h-4 w-4" />
                    {c.nav.language}
                  </button>
                  <Link
                    href={LANDING_ROUTES.login}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 w-full items-center justify-center rounded-lg border border-border text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.nav.signIn}
                  </Link>
                  <Link
                    href={LANDING_ROUTES.signup}
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 w-full items-center justify-center rounded-lg bg-foreground text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.nav.primaryCta}
                  </Link>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <header
      data-testid="landing-header"
      className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90"
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link
          href={LANDING_ROUTES.home}
          className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <button
            type="button"
            data-testid="landing-theme-toggle"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="hidden size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            aria-label={c.nav.theme}
            title={c.nav.theme}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            data-testid="landing-locale-toggle"
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="hidden size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            aria-label={c.nav.language}
            title={c.nav.language}
          >
            <Globe className="h-4 w-4" />
          </button>
          <Link
            href={LANDING_ROUTES.login}
            className="hidden min-h-10 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
          >
            {c.nav.signIn}
          </Link>
          <Link
            href={LANDING_ROUTES.signup}
            data-testid="landing-primary-cta"
            className="inline-flex min-h-10 items-center rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {c.nav.primaryCta}
          </Link>
          <button
            type="button"
            data-testid="landing-menu-trigger"
            className="inline-flex size-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            aria-expanded={open}
            aria-controls={titleId}
            aria-label={open ? c.nav.closeMenu : c.nav.openMenu}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileMenu}
    </header>
  );
}
