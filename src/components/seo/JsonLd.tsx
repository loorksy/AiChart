import type { JsonLdGraph } from "@/lib/seo";

export function JsonLd({ data }: { data: JsonLdGraph }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
