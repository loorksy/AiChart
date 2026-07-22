import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingPartners } from "@/components/landing/LandingPartners";
import { LandingBenefits } from "@/components/landing/LandingBenefits";
import { LandingHowItWorks } from "@/components/landing/LandingHowItWorks";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingWorkspace } from "@/components/landing/LandingWorkspace";
import { LandingTrust } from "@/components/landing/LandingTrust";
import { LandingTestimonials } from "@/components/landing/LandingTestimonials";
import { LandingHistory } from "@/components/landing/LandingHistory";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { LandingFaq } from "@/components/landing/LandingFaq";
import { LandingCta } from "@/components/landing/LandingCta";
import { LandingFooter } from "@/components/landing/LandingFooter";

/**
 * Public landing — neutral AiChart marketing surface.
 * Redesigned with 21st.dev community blocks and bilingual copy.
 */
export default function LandingPage() {
  return (
    <div
      data-testid="landing-page"
      className="min-h-dvh bg-background text-foreground"
    >
      <LandingNav />
      <main id="main">
        <LandingHero />
        <LandingPartners />
        <LandingBenefits />
        <LandingHowItWorks />
        <LandingStats />
        <LandingWorkspace />
        <LandingTrust />
        <LandingTestimonials />
        <LandingHistory />
        <LandingPricing />
        <LandingFaq />
        <LandingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
