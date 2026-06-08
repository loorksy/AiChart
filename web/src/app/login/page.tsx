import AuthForm from "@/components/AuthForm";
import { getBotUsername, isTelegramConfigured } from "@/lib/telegram";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const redirectTo =
    next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  const telegramConfigured = isTelegramConfigured();
  const botUsername = telegramConfigured ? await getBotUsername() : null;

  return (
    <AuthForm
      mode="login"
      redirectTo={redirectTo}
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
    />
  );
}
