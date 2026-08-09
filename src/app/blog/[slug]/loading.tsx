import { ArticleSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** A single post. */
export default function BlogSlugLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <ArticleSkeleton paragraphs={5} />
    </main>
  );
}
