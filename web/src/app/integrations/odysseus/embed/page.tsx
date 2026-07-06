import { Suspense } from "react";
import OdysseusEmbedClient from "@/components/OdysseusEmbedClient";

export const metadata = {
  title: "AiChart — Odysseus embed",
  robots: "noindex",
};

export default function OdysseusEmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
          جاري تحميل الشارت…
        </div>
      }
    >
      <OdysseusEmbedClient />
    </Suspense>
  );
}
