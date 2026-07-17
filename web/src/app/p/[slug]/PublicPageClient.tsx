"use client";

import ReactMarkdown from "react-markdown";
import { useLocale } from "@/components/LocaleProvider";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";

interface PublicPageClientProps {
  page: {
    slug: string;
    title_ar: string;
    title_en: string;
    content_ar: string;
    content_en: string;
    metadata_json: string;
  };
}

export function PublicPageClient({ page }: PublicPageClientProps) {
  const { locale } = useLocale();

  const title = locale === "ar" ? page.title_ar : page.title_en;
  const content = locale === "ar" ? page.content_ar : page.content_en;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <LandingNav />
      <main id="main" className="flex min-h-[75vh] flex-col px-4 pb-16 pt-10">
        <article className="prose prose-neutral dark:prose-invert mx-auto w-full max-w-4xl flex-1 space-y-6">
          <header className="border-b border-border pb-4">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>
          </header>
          <div className="text-base leading-relaxed text-foreground/90 prose-headings:text-foreground prose-a:text-foreground prose-strong:text-foreground prose-li:my-0.5">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
