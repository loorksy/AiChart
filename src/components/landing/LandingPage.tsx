import { JsonLd } from "@/components/seo/JsonLd";
import { faqJsonLd } from "@/lib/seo";
import { PublicChrome } from "@/components/landing/PublicChrome";
import { LandingHero } from "@/components/landing/LandingHero";

/**
 * Public landing — one viewport, no marketing scroll.
 * Registration-closed is the default; the surface must still render.
 */
export default async function LandingPage() {
  return (
    <PublicChrome lockViewport>
      <JsonLd data={faqJsonLd()} />
      <main id="main" tabIndex={-1} className="relative z-10 h-full min-h-0">
        <LandingHero />
      </main>
    </PublicChrome>
  );
}
