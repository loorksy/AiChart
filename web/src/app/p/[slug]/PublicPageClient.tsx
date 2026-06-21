"use client";

import ReactMarkdown from "react-markdown";
import { useLocale } from "@/components/LocaleProvider";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { ChartBackground } from "@/components/ui/chart-background";

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
    <ChartBackground>
      <LandingNav />
      <main className="min-h-[75vh] flex flex-col pt-24 pb-16 px-4">
        <article className="prose prose-invert max-w-4xl mx-auto w-full flex-1 space-y-6">
          <header className="border-b border-border pb-4">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>
          </header>
          <div className="text-foreground/90 leading-relaxed text-base prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground prose-li:my-0.5">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </article>
      </main>
      <LandingFooter />
    </ChartBackground>
  );
}
