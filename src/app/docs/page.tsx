import { redirect } from "next/navigation";

/** V2-C (#97): /docs opens at the getting-started guide. */
export default function DocsIndexPage() {
  redirect("/docs/docs-getting-started");
}
