import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { PublicPageClient } from "./PublicPageClient";

export default async function PublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page: any = await queryOne(
    "SELECT slug, title_ar, title_en, content_ar, content_en, is_published, metadata_json FROM dynamic_pages WHERE slug = ?",
    [slug]
  );

  if (!page) {
    notFound();
  }

  const isPublished = typeof page.is_published === "boolean" ? page.is_published : Boolean(page.is_published);
  if (!isPublished) {
    notFound();
  }

  return <PublicPageClient page={page} />;
}
