import { JsonLd } from "@/components/seo/JsonLd";
import { faqJsonLd } from "@/lib/seo";
import { isRegistrationOpen } from "@/lib/auth/registration";
import { HorizonBackground } from "@/components/landing/HorizonBackground";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";

/**
 * Public landing — one viewport, no marketing scroll.
 * Registration-closed is the default; the surface must still render.
 */
export default async function LandingPage() {
  let registrationOpen = false;
  try {
    registrationOpen = await isRegistrationOpen();
  } catch {
    registrationOpen = false;
  }

  return (
    <div
      data-testid="landing-page"
      className="landing-viewport relative bg-black text-white"
    >
      <JsonLd data={faqJsonLd()} />
      <HorizonBackground />
      <LandingNav variant="full" registrationOpen={registrationOpen} />
      <main id="main" tabIndex={-1} className="relative z-10 h-full min-h-0">
        <LandingHero />
      </main>
    </div>
  );
}
