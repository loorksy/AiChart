import Link from "next/link";
import { Newspaper } from "lucide-react";
import { initDb, query } from "@/lib/db";
import { seedContentPages } from "@/lib/content/seedContent";
import { EmptyState, SkipLink, Surface } from "@/components/foundation";
import { AiChartLogo } from "@/components/AiChartLogo";
import { BRAND_NAME } from "@/lib/brand";

export const metadata = {
  title: `المدونة — ${BRAND_NAME}`,
  description: "مقالات عن التداول الذكي، المنصة، وكيف نبني أدواتها.",
};
export const dynamic = "force-dynamic";

/** V2-C (#97): the public blog index, served from dynamic_pages kind='blog'. */
export default async function BlogIndexPage() {
  await initDb();
  await seedContentPages();
  const posts = await query<{
    slug: string;
    title_ar: string;
    content_ar: string;
    updated_at: string;
  }>(
    "SELECT slug, title_ar, content_ar, updated_at FROM dynamic_pages WHERE kind = 'blog'  ORDER BY updated_at DESC",
  );

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <SkipLink targetId="blog-main">تخطَّ إلى المحتوى</SkipLink>

      <header className="flex min-h-14 items-center justify-between border-b border-border/60 bg-card/80 px-4 backdrop-blur-md sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AiChartLogo size={22} showName />
        </Link>
        <nav aria-label="روابط الموقع" className="flex items-center gap-1 text-sm">
          <Link
            href="/docs"
            className="inline-flex min-h-11 items-center rounded-md px-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            التوثيق
          </Link>
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center rounded-md px-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            الأسعار
          </Link>
          <a
            href="/blog/rss.xml"
            className="inline-flex min-h-11 items-center rounded-md px-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            RSS
          </a>
        </nav>
      </header>

      <main id="blog-main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
        <h1 className="type-title text-3xl">المدونة</h1>

        {posts.length === 0 ? (
          <Surface padding="none" className="mt-8">
            <EmptyState
              icon={<Newspaper aria-hidden="true" />}
              title="لا مقالات منشورة بعد"
              description="نكتب عن التداول الذكي وكيف نبني أدوات المنصة — عُد قريباً."
            />
          </Surface>
        ) : (
          <div className="mt-8 space-y-6">
            {posts.map((post) => (
              // Stretched link: the whole card is clickable but only the
              // heading text is announced as the link target.
              <Surface key={post.slug} as="article" interactive padding="lg" className="relative">
                <h2 className="text-lg font-semibold text-foreground">
                  <Link
                    href={`/blog/${post.slug}`}
                    className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {post.title_ar}
                  </Link>
                </h2>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {post.content_ar.replace(/[#*_`>-]/g, "").slice(0, 220)}
                </p>
              </Surface>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
