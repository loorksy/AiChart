import AuthForm from "@/components/AuthForm";
import { getTelegramLoginConfig } from "@/lib/telegram";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const redirectTo =
    next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  const { telegramConfigured, botUsername } = await getTelegramLoginConfig();

  return (
    <AuthForm
      mode="login"
      redirectTo={redirectTo}
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
      gateMode={false}
    />
  );
}
