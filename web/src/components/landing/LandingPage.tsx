import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingBenefits } from "@/components/landing/LandingBenefits";
import { LandingHowItWorks } from "@/components/landing/LandingHowItWorks";
import { LandingWorkspace } from "@/components/landing/LandingWorkspace";
import { LandingTrust } from "@/components/landing/LandingTrust";
import { LandingIntegrations } from "@/components/landing/LandingIntegrations";
import { LandingHistory } from "@/components/landing/LandingHistory";
import { LandingFaq } from "@/components/landing/LandingFaq";
import { LandingCta } from "@/components/landing/LandingCta";
import { LandingFooter } from "@/components/landing/LandingFooter";

/**
 * Public landing — neutral AiChart marketing surface.
 * No TradingView runtime, no candlestick backdrop, no authenticated app shell.
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
        <LandingBenefits />
        <LandingHowItWorks />
        <LandingWorkspace />
        <LandingTrust />
        <LandingIntegrations />
        <LandingHistory />
        <LandingFaq />
        <LandingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
