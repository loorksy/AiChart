import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AuthForm from "@/components/AuthForm";
import { PublicChrome } from "@/components/landing/PublicChrome";
import { getTelegramLoginConfig } from "@/lib/telegram";
import { isSingleUserMode } from "@/lib/agentAuth";
import { detectCountryFromHeaders } from "@/lib/geoCountry";
import { googleAuthConfig } from "@/lib/auth/googleOidc";
import { isRegistrationOpen } from "@/lib/auth/registration";
import { initDb } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("signup");

export default async function SignupPage() {
  if (isSingleUserMode()) redirect("/login");

  const h = await headers();
  const defaultCountry = detectCountryFromHeaders(h);
  await initDb();
  const [{ telegramConfigured, botUsername }, google, registrationOpen] =
    await Promise.all([
      getTelegramLoginConfig(),
      googleAuthConfig(),
      isRegistrationOpen(),
    ]);

  return (
    <PublicChrome skipTargetId="auth-main" registrationOpen={registrationOpen}>
      <AuthForm
        mode="register"
        botUsername={botUsername}
        telegramConfigured={telegramConfigured}
        googleConfigured={google != null}
        defaultCountry={defaultCountry}
        registrationOpen={registrationOpen}
      />
    </PublicChrome>
  );
}
