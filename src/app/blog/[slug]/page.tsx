import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { initDb, queryOne } from "@/lib/db";
import { seedContentPages } from "@/lib/content/seedContent";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";

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
    "SELECT title_ar, content_ar, updated_at FROM dynamic_pages WHERE slug = ? AND kind = 'blog' ",
    [slug],
  );
  if (!post) notFound();

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <LandingNav
        variant="compact"
        skipTargetId="blog-post-main"
        links={[{ href: "/blog", label: "← كل المقالات" }]}
      />
      <main
        id="blog-post-main"
        tabIndex={-1}
        className="mx-auto max-w-3xl px-4 py-12 sm:px-8"
      >
        <article className="prose dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-p:leading-relaxed">
          <h1 className="text-3xl font-bold text-foreground">{post!.title_ar}</h1>
          <ReactMarkdown>{post!.content_ar}</ReactMarkdown>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
