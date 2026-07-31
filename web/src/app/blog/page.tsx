import Link from "next/link";
import { initDb, query } from "@/lib/db";
import { seedContentPages } from "@/lib/content/seedContent";
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
    "SELECT slug, title_ar, content_ar, updated_at FROM dynamic_pages WHERE kind = 'blog' AND is_published = 1 ORDER BY updated_at DESC",
  );

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <header className="flex min-h-14 items-center justify-between border-b border-border/60 bg-card/80 px-4 backdrop-blur-md sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <AiChartLogo size={22} showName />
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/docs" className="text-muted-foreground hover:text-foreground">التوثيق</Link>
          <Link href="/pricing" className="text-muted-foreground hover:text-foreground">الأسعار</Link>
          <a href="/blog/rss.xml" className="text-muted-foreground hover:text-foreground">RSS</a>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
        <h1 className="text-3xl font-bold text-foreground">المدونة</h1>
        <div className="mt-8 space-y-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block rounded-xl border border-border bg-card p-6 transition-colors hover:bg-muted/40"
            >
              <h2 className="text-lg font-semibold text-foreground">{post.title_ar}</h2>
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {post.content_ar.replace(/[#*_`>-]/g, "").slice(0, 220)}
              </p>
            </Link>
          ))}
          {posts.length === 0 && (
            <p className="text-muted-foreground">لا مقالات منشورة بعد.</p>
          )}
        </div>
      </main>
    </div>
  );
}
