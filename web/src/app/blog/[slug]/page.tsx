import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { initDb, queryOne } from "@/lib/db";
import { seedContentPages } from "@/lib/content/seedContent";
import { AiChartLogo } from "@/components/AiChartLogo";

export const dynamic = "force-dynamic";

/** V2-C (#97): one blog post. */
export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await initDb();
  await seedContentPages();
  const post = await queryOne<{ title_ar: string; content_ar: string; updated_at: string }>(
    "SELECT title_ar, content_ar, updated_at FROM dynamic_pages WHERE slug = ? AND kind = 'blog' AND is_published = 1",
    [slug],
  );
  if (!post) notFound();

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <header className="flex min-h-14 items-center justify-between border-b border-border/60 bg-card/80 px-4 backdrop-blur-md sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <AiChartLogo size={22} showName />
        </Link>
        <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground">
          ← كل المقالات
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
        <article className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-p:leading-relaxed">
          <h1 className="text-3xl font-bold text-foreground">{post!.title_ar}</h1>
          <ReactMarkdown>{post!.content_ar}</ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
