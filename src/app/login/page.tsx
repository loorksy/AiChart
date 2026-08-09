import AuthForm from "@/components/AuthForm";
import { getTelegramLoginConfig } from "@/lib/telegram";
import { googleAuthConfig } from "@/lib/auth/googleOidc";
import { initDb } from "@/lib/db";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const redirectTo =
    next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  await initDb();
  const [{ telegramConfigured, botUsername }, google] = await Promise.all([
    getTelegramLoginConfig(),
    googleAuthConfig(),
  ]);

  return (
    <AuthForm
      mode="login"
      redirectTo={redirectTo}
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
      googleConfigured={google != null}
      gateMode={false}
    />
  );
}
