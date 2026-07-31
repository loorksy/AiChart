import { initDb, query } from "@/lib/db";
import { seedContentPages } from "@/lib/content/seedContent";
import { getPlatformValueAsync } from "@/lib/platformConfig";
import { BRAND_NAME } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** V2-C (#97): blog RSS feed. */
export async function GET() {
  await initDb();
  await seedContentPages();
  const base =
    (await getPlatformValueAsync("APP_URL"))?.replace(/\/$/, "") ??
    "https://aichart.lork.cloud";
  const posts = await query<{ slug: string; title_ar: string; content_ar: string; updated_at: string }>(
    "SELECT slug, title_ar, content_ar, updated_at FROM dynamic_pages WHERE kind = 'blog' AND is_published = 1 ORDER BY updated_at DESC LIMIT 20",
  );
  const items = posts
    .map(
      (p) => `    <item>
      <title>${esc(p.title_ar)}</title>
      <link>${base}/blog/${p.slug}</link>
      <guid>${base}/blog/${p.slug}</guid>
      <description>${esc(p.content_ar.slice(0, 300))}</description>
    </item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(BRAND_NAME)} — المدونة</title>
    <link>${base}/blog</link>
    <description>مقالات ${esc(BRAND_NAME)}</description>
${items}
  </channel>
</rss>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
