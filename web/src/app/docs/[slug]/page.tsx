import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { initDb, queryOne } from "@/lib/db";
import { seedContentPages } from "@/lib/content/seedContent";

export const dynamic = "force-dynamic";

/** V2-C (#97): one docs page. */
export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await initDb();
  await seedContentPages();
  const doc = await queryOne<{ title_ar: string; content_ar: string }>(
    "SELECT title_ar, content_ar FROM dynamic_pages WHERE slug = ? AND kind = 'doc' AND is_published = 1",
    [slug],
  );
  if (!doc) notFound();

  return (
    <article className="prose prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-p:leading-relaxed prose-li:text-muted-foreground">
      <ReactMarkdown>{doc!.content_ar}</ReactMarkdown>
    </article>
  );
}
