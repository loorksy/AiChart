import AuthForm from "@/components/AuthForm";
import { getBotUsername, isTelegramConfigured } from "@/lib/telegram";

export default async function RegisterPage() {
  const telegramConfigured = isTelegramConfigured();
  const botUsername = telegramConfigured ? await getBotUsername() : null;

  return (
    <AuthForm
      mode="register"
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
    />
  );
}
