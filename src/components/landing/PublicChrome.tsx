import { isRegistrationOpen } from "@/lib/auth/registration";
import { HorizonBackground } from "@/components/landing/HorizonBackground";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingNav } from "@/components/landing/LandingNav";
import { cn } from "@/lib/utils";

/** Shared top offset so page content clears the always-visible logo + menu. */
export const PUBLIC_MAIN_PAD =
  "relative z-10 px-4 pb-16 pt-[max(5.5rem,calc(env(safe-area-inset-top)+4.5rem))] sm:px-8";

export interface PublicChromeProps {
  children: React.ReactNode;
  skipTargetId?: string;
  /** Landing: lock to one viewport. Other public pages may scroll. */
  lockViewport?: boolean;
  /** Marketing/legal pages get the dark footer. Auth pages do not. */
  showFooter?: boolean;
  registrationOpen?: boolean;
}

/**
 * Shared public/marketing chrome: horizon background, always-visible LONORA
 * wordmark top-left, hamburger overlay top-right. No theme or language
 * controls — those live on login/signup (language) and in-app settings (both).
 */
export async function PublicChrome({
  children,
  skipTargetId = "main",
  lockViewport = false,
  showFooter = false,
  registrationOpen: registrationOpenProp,
}: PublicChromeProps) {
  let registrationOpen = registrationOpenProp ?? false;
  if (registrationOpenProp === undefined) {
    try {
      registrationOpen = await isRegistrationOpen();
    } catch {
      registrationOpen = false;
    }
  }

  return (
    <div
      data-testid={lockViewport ? "landing-page" : "public-chrome"}
      className={cn(
        "dark relative bg-black text-white",
        lockViewport ? "landing-viewport" : "min-h-dvh overflow-x-hidden",
      )}
    >
      <HorizonBackground />
      <LandingNav skipTargetId={skipTargetId} registrationOpen={registrationOpen} />
      {children}
      {showFooter ? <LandingFooter registrationOpen={registrationOpen} /> : null}
    </div>
  );
}
