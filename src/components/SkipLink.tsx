"use client";

import { useLocale } from "@/hooks/useLocale";

export function SkipLink() {
  const { t } = useLocale();

  return (
    <a
      href="#main-content"
      onClick={(event) => {
        const main = document.querySelector<HTMLElement>("main, [role='main']");
        if (!main) return;
        event.preventDefault();
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus();
        main.scrollIntoView({ block: "start" });
      }}
      className="sr-only fixed start-3 top-3 z-[100] rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      {t("a11y.skip_to_content")}
    </a>
  );
}
