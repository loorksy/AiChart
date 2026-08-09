import Link from "next/link";
import { initDb, query } from "@/lib/db";
import { seedContentPages } from "@/lib/content/seedContent";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { BRAND_NAME } from "@/lib/brand";

export const metadata = { title: `التوثيق — ${BRAND_NAME}` };

/** V2-C (#97): docs shell — sidebar tree from dynamic_pages kind='doc'. */
export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await initDb();
  await seedContentPages();
  const docs = await query<{ slug: string; title_ar: string }>(
    "SELECT slug, title_ar FROM dynamic_pages WHERE kind = 'doc'  ORDER BY slug",
  );

  return (
    <div dir="rtl" className="min-h-dvh bg-background">
      <LandingNav
        variant="compact"
        skipTargetId="docs-main"
        links={[
          { href: "/blog", label: "المدونة" },
          { href: "/pricing", label: "الأسعار" },
        ]}
      />
      <div className="mx-auto flex max-w-5xl gap-8 px-4 py-10 sm:px-8">
        <aside className="hidden w-56 shrink-0 md:block">
          <p className="mb-3 text-xs font-semibold text-muted-foreground">التوثيق</p>
          <nav className="space-y-1">
            {docs.map((doc) => (
              <Link
                key={doc.slug}
                href={`/docs/${doc.slug}`}
                className="block rounded-[var(--radius)] px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {doc.title_ar}
              </Link>
            ))}
          </nav>
        </aside>
        <main id="docs-main" tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <LandingFooter />
    </div>
  );
}
