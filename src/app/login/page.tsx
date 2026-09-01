import AuthForm from "@/components/AuthForm";
import { PublicChrome } from "@/components/landing/PublicChrome";
import { getTelegramLoginConfig } from "@/lib/telegram";
import { googleAuthConfig } from "@/lib/auth/googleOidc";
import { isRegistrationOpen } from "@/lib/auth/registration";
import { initDb } from "@/lib/db";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata("login");

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const redirectTo =
    next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  await initDb();
  const [{ telegramConfigured, botUsername }, google, registrationOpen] =
    await Promise.all([
      getTelegramLoginConfig(),
      googleAuthConfig(),
      isRegistrationOpen(),
    ]);
  const closedError =
    error === "registration_closed" || error === "google_registration_closed"
      ? "registration_closed"
      : undefined;

  return (
    <PublicChrome skipTargetId="auth-main" registrationOpen={registrationOpen}>
      <AuthForm
        mode="login"
        redirectTo={redirectTo}
        botUsername={botUsername}
        telegramConfigured={telegramConfigured}
        googleConfigured={google != null}
        gateMode={false}
        allowRegister={registrationOpen}
        initialError={closedError}
      />
    </PublicChrome>
  );
}
