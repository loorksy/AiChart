import { ChartBackground } from "@/components/ui/chart-background";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingPerformance } from "@/components/landing/LandingPerformance";
import { LandingHowItWorks } from "@/components/landing/LandingHowItWorks";
import { LandingIntegrations } from "@/components/landing/LandingIntegrations";
import { LandingSecurity } from "@/components/landing/LandingSecurity";
import { LandingAccess } from "@/components/landing/LandingAccess";
import { LandingFaq } from "@/components/landing/LandingFaq";
import { LandingCta } from "@/components/landing/LandingCta";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function LandingPage() {
  return (
    <ChartBackground>
      <LandingNav />
      <main>
        <LandingHero />
        <LandingFeatures />
        <LandingPerformance />
        <LandingHowItWorks />
        <LandingIntegrations />
        <LandingSecurity />
        <LandingAccess />
        <LandingFaq />
        <LandingCta />
      </main>
      <LandingFooter />
    </ChartBackground>
  );
}
